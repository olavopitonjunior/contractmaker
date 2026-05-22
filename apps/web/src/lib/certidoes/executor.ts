import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { callInfosimples, downloadReceipt, InfosimplesError } from "./infosimples";
import { callSerasa } from "@/lib/serasa/client";
import { SerasaError } from "@/lib/serasa/types";
import { normalize } from "./normalizers";
import { normalizeSerasa } from "./serasa-normalizers";
import { renderSerasaHtml, type SerasaRenderContext } from "./serasa-render";
import { exportPdfToBuffer } from "@/lib/render/exporter";
import { endpointInfo } from "./endpoints";
import { classifyOutcome } from "./outcome-classifier";
import {
  isPedidoDuplicado,
  mapInfosimplesCodeToCategory,
  decideObterOutcome,
} from "./error-codes";
import type { InfosimplesResponse, JobStatus, Situacao, TargetKind } from "./types";
import { emitNotification } from "@/lib/notifications/emit";

/**
 * Phase G.1 — audit log helper (fire-and-forget). Registra transições de
 * status no CertidaoJobAuditLog para observabilidade + debug.
 *
 * Nunca lança erro — falha silenciosa via console.error. Não bloqueia a
 * transição principal do job.
 */
function logTransition(
  jobId: string,
  fromStatus: string | null,
  toStatus: string,
  reason?: string,
  metadata?: Record<string, unknown>
): void {
  void prisma.certidaoJobAuditLog
    .create({
      data: {
        jobId,
        fromStatus,
        toStatus,
        reason: reason ?? null,
        metadata: metadata ? (metadata as object) : undefined,
      },
    })
    .catch((err) => {
      console.error(
        "[audit-log] failed to record transition:",
        err instanceof Error ? err.message : String(err)
      );
    });
}

// F4 — terminal states for a job. `awaiting_portal` is NOT terminal for
// notification purposes (user will get notified when it completes in the
// portal poller). Replaced jobs are ignored entirely.
const TERMINAL_FOR_NOTIFICATION = new Set<string>([
  "success",
  "failed",
  "skipped",
]);

/**
 * F4 — Adaptive retry delay for awaiting_portal jobs.
 *
 *   - TJSP: normally ready in 5-15min, so poll aggressively in the first 2h
 *     (every 30min), then back off to every 2h after that.
 *   - TJRJ: can take up to 8 business days, so poll every 6h in the first
 *     48h, then every 24h.
 *
 * Returns the milliseconds delta to add to `expectedReadyAt`.
 */
function computeAdaptiveRetryDelta(
  endpoint: string,
  createdAt: Date
): number {
  const ageMs = Date.now() - createdAt.getTime();
  const twoHoursMs = 2 * 60 * 60_000;
  const fortyEightHoursMs = 48 * 60 * 60_000;
  if (endpoint.includes("/tjsp/")) {
    return ageMs < twoHoursMs ? 30 * 60_000 : 2 * 60 * 60_000;
  }
  if (endpoint.includes("/tjrj/")) {
    return ageMs < fortyEightHoursMs ? 6 * 60 * 60_000 : 24 * 60 * 60_000;
  }
  // ONR matrícula: imediato a 5 dias úteis → 6h nas primeiras 48h, depois 24h.
  if (endpoint.startsWith("registradores/")) {
    return ageMs < fortyEightHoursMs ? 6 * 60 * 60_000 : 24 * 60 * 60_000;
  }
  // Antecedentes PF: normalmente instantâneo → poll agressivo a cada 30min.
  if (endpoint.startsWith("antecedentes-criminais/")) {
    return 30 * 60_000;
  }
  // Unknown portal type — fall back to the old fixed 12h
  return 12 * 60 * 60_000;
}

/**
 * F4 — Computes the initial `expectedReadyAt` for a freshly-submitted
 * two-step portal job. TJSP is polled first at 30min, TJRJ at 6h.
 */
function computeInitialExpectedReadyAt(endpoint: string): Date {
  const expected = new Date();
  if (endpoint.includes("/tjsp/") || endpoint.startsWith("antecedentes-criminais/")) {
    expected.setTime(expected.getTime() + 30 * 60_000); // 30 min
  } else if (endpoint.includes("/tjrj/") || endpoint.startsWith("registradores/")) {
    expected.setTime(expected.getTime() + 6 * 60 * 60_000); // 6h
  } else {
    expected.setTime(expected.getTime() + 60 * 60_000); // 1h default
  }
  return expected;
}

/**
 * Prazo máximo (ms) que um pedido two-step pode ficar em awaiting_portal antes
 * de virar problema. Substitui o MAX_AGE fixo de 14d — cada portal tem ritmo
 * próprio (TJSP costuma sair em min/horas; TJRJ pode levar dias úteis).
 */
function maxPortalWaitMs(endpoint: string): number {
  if (endpoint.includes("/tjsp/")) return 12 * 60 * 60_000; // 12h
  if (endpoint.includes("/tjrj/")) return 14 * 24 * 60 * 60_000; // ~10 dias úteis
  if (endpoint.includes("/tjms/")) return 3 * 24 * 60 * 60_000; // 3 dias
  if (endpoint.includes("/trf3/")) return 2 * 24 * 60 * 60_000; // 2 dias
  if (endpoint.startsWith("registradores/")) return 14 * 24 * 60 * 60_000; // ~5 dias úteis + folga
  if (endpoint.startsWith("antecedentes-criminais/")) return 24 * 60 * 60_000; // 1 dia
  return 2 * 24 * 60 * 60_000;
}

/**
 * Phase L — Resolve o endpoint do 2º passo (obter/download/validar) a partir do
 * endpoint do pedido (1º passo). Tabela por prefixo cobrindo todos os fluxos
 * two-step. Antes era uma cadeia hardcoded só com tjsp/tjrj/trf3 — ONR
 * matrícula, TJMS e Antecedentes PF caíam em null e ficavam presos.
 */
export function resolveObterEndpoint(pedidoEndpoint: string): string | null {
  if (pedidoEndpoint.includes("/tjsp/")) return "tribunal/tjsp/obter-civel";
  if (pedidoEndpoint.includes("/tjrj/")) return "tribunal/tjrj/obter-certidao";
  if (pedidoEndpoint.includes("/trf3/")) return "tribunal/trf3/obter-certidao";
  if (pedidoEndpoint.includes("/tjms/")) return "tribunal/tjms/obter-certidao";
  if (pedidoEndpoint === "registradores/matric-pedido")
    return "registradores/matric-download";
  if (pedidoEndpoint === "antecedentes-criminais/pf/emit")
    return "antecedentes-criminais/pf/val";
  return null;
}

// Memo curto (TTL 60s) do gasto mensal por org — evita refazer o aggregate a
// cada job numa varredura de cron (50+ jobs). Escopo de processo.
const _spendMemo = new Map<string, { exceeded: boolean; ts: number }>();

/**
 * Fase 0 — Guard de custo/crédito. Antes de QUALQUER chamada paga à Infosimples
 * (cron de poll/retry incluso), verifica se a org deve ser bloqueada:
 *   - `budget`: gasto mensal já estourou INFOSIMPLES_MONTHLY_BUDGET_CENTS.
 *   - `credit`: houve 603/604 ("limite de uso"/token) nos últimos 30min →
 *     crédito Infosimples provavelmente esgotado; para de martelar a API até
 *     recarga. (Infosimples não tem API de saldo; o 603 é o sinal in-band.)
 * Retorna {blocked:false} quando orgId é nulo (não dá pra escopar).
 */
async function isOrgInfosimplesBlocked(
  orgId: string | null | undefined
): Promise<{ blocked: boolean; reason?: "budget" | "credit" }> {
  if (!orgId) return { blocked: false };
  const memo = _spendMemo.get(orgId);
  let exceeded: boolean;
  if (memo && Date.now() - memo.ts < 60_000) {
    exceeded = memo.exceeded;
  } else {
    exceeded = (await getMonthlySpend(orgId)).exceeded;
    _spendMemo.set(orgId, { exceeded, ts: Date.now() });
  }
  if (exceeded) return { blocked: true, reason: "budget" };
  const recent603 = await prisma.certidaoJob.findFirst({
    where: {
      orgId,
      resultCode: { in: [603, 604] },
      finishedAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
    select: { id: true },
  });
  if (recent603) return { blocked: true, reason: "credit" };
  return { blocked: false };
}

/**
 * Fase 2 — Emite UM alerta de problema por lote (sino, deduped por batchId via
 * unique constraint em emitNotification). Fire-and-forget. O e-mail resumo é
 * enviado pelo cron diário `certidoes/problem-digest`.
 */
async function reportCertidaoProblem(
  job: { id: string; orgId: string | null; dealId: string | null; batchId: string; endpoint: string; label: string },
  reason: string
): Promise<void> {
  if (!job.orgId || !job.dealId) return;
  await emitNotification({
    orgId: job.orgId,
    type: "certidao_problem",
    title: "Certidões com problema",
    body: `Há certidões que não puderam ser emitidas (${reason}). Abra o relatório de certidões do negócio.`,
    linkUrl: `/deals/${job.dealId}`,
    batchId: job.batchId,
    metadata: { jobId: job.id, endpoint: job.endpoint, label: job.label, reason },
  });
}

/**
 * F4 — Emits a `certidao_batch_complete` notification when ALL non-replaced
 * jobs in a batch reach a terminal state. Uses `metadata.batchId` for
 * idempotency — if a notification was already emitted for this batch, this
 * is a no-op. Fire-and-forget: never throws.
 *
 * For single-job batches (retries, complementar, cherry-picks), emits a
 * more specific `certidao_ready` title instead of the aggregated one.
 */
async function checkBatchCompletion(batchId: string): Promise<void> {
  try {
    // Idempotency: skip if already notified
    const existing = await prisma.notification.findFirst({
      where: {
        type: "certidao_batch_complete",
        metadata: { path: ["batchId"], equals: batchId },
      },
      select: { id: true },
    });
    if (existing) return;

    const jobs = await prisma.certidaoJob.findMany({
      where: { batchId, status: { not: "replaced" } },
      include: {
        deal: {
          select: {
            id: true,
            title: true,
            form: { select: { orgId: true } },
          },
        },
      },
    });
    if (jobs.length === 0) return;

    // If ANY job is still non-terminal, bail — we'll try again later.
    const pendingCount = jobs.filter(
      (j) => !TERMINAL_FOR_NOTIFICATION.has(j.status)
    ).length;
    if (pendingCount > 0) return;

    // All terminal — emit the notification.
    // Phase C: jobs podem ser deal-scoped (first.deal não-null) ou ad-hoc
    // (first.orgId). Priorizar deal quando existe para manter UX atual.
    const first = jobs[0];
    const orgId = first.deal?.form?.orgId ?? first.orgId;
    if (!orgId) return; // needs org to scope notifications

    const success = jobs.filter((j) => j.status === "success").length;
    const failed = jobs.filter((j) => j.status === "failed").length;
    const skipped = jobs.filter((j) => j.status === "skipped").length;
    const positivas = jobs.filter((j) => {
      if (j.status !== "success") return false;
      const r = j.resultData as { situacao?: string } | null;
      return r?.situacao === "positiva" || r?.situacao === "positiva_com_efeitos";
    }).length;

    const dealTitle = first.deal?.title ?? "Diligência avulsa";
    const userId = first.userId;
    const linkUrl = first.deal
      ? `/deals/${first.deal.id}`
      : `/certidoes/adhoc?batch=${batchId}`;
    const scopeMetadata: Record<string, unknown> = { batchId };
    if (first.deal) scopeMetadata.dealId = first.deal.id;
    else scopeMetadata.orgId = orgId;

    // Single-job batches: more specific notification
    if (jobs.length === 1) {
      const job = first;
      const situacao = (job.resultData as { situacao?: string } | null)?.situacao;
      const title =
        job.status === "success"
          ? `Certidão pronta: ${job.label}`
          : job.status === "failed"
          ? `Certidão falhou: ${job.label}`
          : `Certidão pulada: ${job.label}`;
      const body = situacao
        ? `${situacao} — ${dealTitle}`
        : job.errorMessage
        ? `${job.errorMessage.slice(0, 100)} — ${dealTitle}`
        : dealTitle;
      await emitNotification({
        orgId,
        userId,
        type: "certidao_batch_complete",
        title,
        body,
        linkUrl,
        metadata: { ...scopeMetadata, jobId: job.id },
        batchId,
      });
      return;
    }

    // Multi-job batch: aggregated title + breakdown body
    const parts: string[] = [];
    if (success > 0) parts.push(`${success} ✓`);
    if (positivas > 0) parts.push(`${positivas} positiva(s)`);
    if (failed > 0) parts.push(`${failed} falha(s)`);
    if (skipped > 0) parts.push(`${skipped} pulada(s)`);
    const breakdown = parts.join(" · ");

    await emitNotification({
      orgId,
      userId,
      type: "certidao_batch_complete",
      title: `Batch de ${jobs.length} certidões concluído`,
      body: `${breakdown} — ${dealTitle}`,
      linkUrl,
      metadata: scopeMetadata,
      batchId,
    });
  } catch (err) {
    console.error(
      "[checkBatchCompletion] failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

const CONCURRENCY = 5;

/**
 * Minimal p-limit inline implementation.
 */
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    if (queue.length > 0) {
      const fn = queue.shift();
      fn?.();
    }
  };
  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then((v) => {
            resolve(v);
            next();
          })
          .catch((e) => {
            reject(e);
            next();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

/**
 * Execute all jobs in a batch. Updates each CertidaoJob row as it progresses.
 * Designed to be called in fire-and-forget fashion from the route handler.
 *
 * F4: after all jobs in the batch reach a terminal state (for fast federal
 * endpoints that complete synchronously), emits a notification via
 * `checkBatchCompletion`. For batches with two-step portals, the final
 * completion check happens later in `pollPortalJob` when the last portal
 * job transitions to success/failed.
 */
export async function runBatch(
  batchId: string,
  dealId: string | null
): Promise<void> {
  // Phase C: dealId nullable → ad-hoc batches scoped só pelo batchId.
  // Filtro SQL ajustado para não exigir dealId quando null.
  const jobs = await prisma.certidaoJob.findMany({
    where: {
      batchId,
      ...(dealId ? { dealId } : {}),
      status: "pending",
    },
  });
  if (jobs.length === 0) return;

  const limit = pLimit(CONCURRENCY);
  await Promise.allSettled(jobs.map((j) => limit(() => runSingleJob(j.id, dealId))));

  // F4: check if the batch is fully done and emit notification
  await checkBatchCompletion(batchId);
}

/**
 * Run a single job: call Infosimples, normalize, download receipt, link to attachment.
 * Handles two-step portals (TJSP/TJRJ) by transitioning to awaiting_portal.
 */
export async function runSingleJob(
  jobId: string,
  dealId: string | null
): Promise<void> {
  const job = await prisma.certidaoJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const startedAt = new Date();
  await prisma.certidaoJob.update({
    where: { id: jobId },
    data: { status: "fetching", startedAt, retryCount: { increment: 0 } },
  });
  logTransition(jobId, job.status, "fetching", "runSingleJob dispatch", {
    endpoint: job.endpoint,
  });

  const info = endpointInfo(job.endpoint);

  // Multi-provider dispatch. Serasa devolve JSON estruturado (sem PDF de
  // portal), então tem seu próprio caminho — runSerasaJob cuida de normalizar,
  // gerar PDF próprio via Puppeteer e anexar como DealAttachment.
  if (info.provider === "serasa") {
    await runSerasaJob(job, dealId, startedAt);
    await checkBatchCompletion(job.batchId);
    return;
  }

  // Fase 0 — guard de custo/crédito (Infosimples): se a org está bloqueada
  // (orçamento mensal estourado ou crédito esgotado via 603 recente), NÃO chama
  // a API paga. Marca como problema em vez de queimar crédito. Protege a task
  // de retry do cron, que chama runSingleJob.
  const blockedRun = await isOrgInfosimplesBlocked(job.orgId);
  if (blockedRun.blocked) {
    const reasonMsg =
      blockedRun.reason === "credit"
        ? "Crédito Infosimples esgotado — recarregue no portal"
        : "Orçamento mensal de certidões esgotado";
    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: { status: "failed_permanent", finishedAt: new Date(), errorMessage: reasonMsg, portalUrl: job.portalUrl ?? info.portalUrl ?? null },
    });
    logTransition(jobId, "fetching", "failed_permanent", `blocked:${blockedRun.reason} (sem chamada)`, { endpoint: job.endpoint });
    await reportCertidaoProblem(job, blockedRun.reason === "credit" ? "crédito Infosimples esgotado" : "orçamento mensal esgotado");
    await checkBatchCompletion(job.batchId);
    return;
  }

  try {
    const args = job.requestPayload as Record<string, unknown>;
    const resp = await callInfosimples(job.endpoint, args);
    const latencyMs = Date.now() - startedAt.getTime();

    // Two-step portal: the pedido call returns numero_pedido; mark as awaiting.
    const isPedido = info.twoStep === true;
    if (isPedido && resp.code === 200) {
      const d = (resp.data?.[0] as Record<string, unknown>) ?? {};
      // Protocolo p/ o 2º passo (obter). Cada portal usa um campo diferente:
      // TJSP/TJRJ → numero_pedido/numero_requerimento; TRF3 → numero_certidao
      // (a Certidão de Distribuição já volta com o número), com fallback no
      // dados_solicitacao.protocolo. O obter usa esse valor (ver pollPortalJob).
      const dadosSolic = d.dados_solicitacao as Record<string, unknown> | undefined;
      const numeroPedido =
        (d.numero_pedido as string) ??
        (d.numero_requerimento as string) ??
        (d.numero_certidao as string) ??
        (dadosSolic?.protocolo as string) ??
        null;
      // F4: adaptive initial delay — TJSP 30min (normally ready in 5-15min),
      // TJRJ 6h (up to 8 business days). Previously fixed 1h / 24h.
      const expected = computeInitialExpectedReadyAt(job.endpoint);
      await prisma.certidaoJob.update({
        where: { id: jobId },
        data: {
          status: "awaiting_portal",
          latencyMs,
          resultCode: resp.code,
          resultMessage: resp.code_message,
          resultData: { numero_pedido: numeroPedido, initial: true },
          expectedReadyAt: expected,
          costCents: info.costCents,
        },
      });
      logTransition(jobId, "fetching", "awaiting_portal", "two-step pedido accepted", {
        endpoint: job.endpoint,
        resultCode: resp.code,
        numero_pedido: numeroPedido,
        expectedReadyAt: expected,
        latencyMs,
        costCents: info.costCents,
      });
      return;
    }

    // Two-step "pedido duplicado": e-SAJ recusa com code 620 quando já existe
    // um pedido do mesmo tipo em processamento (re-disparo enquanto a tentativa
    // anterior ainda roda). NÃO retorna numero_pedido → não dá pra buscar por
    // aqui; a certidão sai pela tentativa original. Marca estado neutro
    // `duplicate_pending` + ETA (em vez de failed_permanent vermelho). NÃO é
    // varrido pelo cron poll-portal (que só pega awaiting_portal). Gate por
    // mensagem — code 620 também serve pra erro de 2FA GOV.BR. Ver
    // isPedidoDuplicado em error-codes.ts.
    const duplicadoMsg = [resp.code_message, ...(resp.errors ?? [])]
      .filter(Boolean)
      .join(" ");
    if (isPedido && resp.code === 620 && isPedidoDuplicado(duplicadoMsg)) {
      const expected = computeInitialExpectedReadyAt(job.endpoint);
      const billable = resp.header?.billable;
      await prisma.certidaoJob.update({
        where: { id: jobId },
        data: {
          status: "duplicate_pending",
          finishedAt: new Date(),
          latencyMs,
          resultCode: resp.code,
          resultMessage: resp.code_message,
          resultData: { duplicate_pending: true, numero_pedido: null },
          errorMessage:
            "Já existe um pedido deste tipo em andamento no portal. A certidão será emitida pela tentativa original — acompanhe no portal se não aparecer.",
          expectedReadyAt: expected,
          costCents: billable === false ? 0 : info.costCents,
          portalUrl: info.portalUrl ?? null,
        },
      });
      logTransition(jobId, "fetching", "duplicate_pending", "pedido duplicado no portal", {
        endpoint: job.endpoint,
        resultCode: resp.code,
        expectedReadyAt: expected,
        latencyMs,
        costCents: billable === false ? 0 : info.costCents,
      });
      await checkBatchCompletion(job.batchId);
      return;
    }

    // Single-step or failed pedido: normalize + attach PDF (if any).
    const normalized = normalize(job.endpoint, resp);
    let attachmentId: string | null = null;
    const receipt = resp.site_receipts?.[0];
    if (receipt && resp.code === 200) {
      attachmentId = await downloadAndAttach(
        dealId,
        job.endpoint,
        job.label,
        receipt,
        job.targetKind,
        job.targetIndex
      );
    }

    // Persist the raw receipt URL alongside normalized data so retry's
    // "re_attach" branch can re-download without a new API call.
    const enrichedResultData: Record<string, unknown> = {
      ...(normalized as unknown as Record<string, unknown>),
    };
    if (receipt) enrichedResultData._rawReceipt = receipt;

    // CENPROT Nacional → encadeia o 2º passo de detalhes dos cartórios SP
    // (follow-up síncrono via campo `obter_detalhes`). Best-effort: falha aqui
    // não altera o status do job nacional.
    let detalhesExtraCostCents = 0;
    if (job.endpoint === "ieptb/protestos" && resp.code === 200) {
      const det = await fetchCenprotDetalhesSp(resp, job, dealId);
      if (det.detalhesSp.length > 0) {
        enrichedResultData.detalhes_sp = det.detalhesSp;
      }
      detalhesExtraCostCents = det.extraCostCents;
    }

    // J.3 (Phase J, 2026-04-18) — classifyOutcome() centraliza a decisão
    // de status rico (success, informativo, api_error, portal_unavailable,
    // data_missing, failed_permanent, …) e agenda retry automático
    // quando apropriado. Substitui a lógica H.1+H.4+H.18 inline; todos os
    // principios (no false-negative, billing honesto, requiresPdf) continuam
    // aplicados internamente pelo classificador.
    const situacaoNorm = (normalized as { situacao?: Situacao }).situacao;
    const billable = resp.header?.billable;
    const outcome = classifyOutcome(resp, normalized, info, {
      attachmentId,
      retryAttempts: job.retryCount ?? 0,
      maxRetries: job.maxRetries ?? 3,
    });

    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: outcome.status,
        finishedAt:
          outcome.status === "api_error" ||
          outcome.status === "portal_unavailable" ||
          outcome.status === "rate_limited"
            ? null // job ainda vivo, cron vai retentar
            : new Date(),
        latencyMs,
        resultCode: resp.code,
        resultMessage: resp.code_message,
        resultData: enrichedResultData as object,
        attachmentId,
        costCents:
          detalhesExtraCostCents > 0
            ? (outcome.costCents ?? 0) + detalhesExtraCostCents
            : outcome.costCents,
        errorMessage: outcome.errorMessage,
        nextRetryAt: outcome.nextRetryAt,
        missingFields: outcome.missingFields,
        portalUrl: outcome.portalUrl,
      },
    });
    logTransition(jobId, "fetching", outcome.status, outcome.errorMessage ?? "infosimples OK", {
      endpoint: job.endpoint,
      resultCode: resp.code,
      situacao: situacaoNorm,
      latencyMs,
      costCents: outcome.costCents,
      billable: billable ?? null,
      hasAttachment: attachmentId !== null,
      failureCategory: outcome.failureCategory,
      nextRetryAt: outcome.nextRetryAt?.toISOString() ?? null,
      missingFieldsCount: outcome.missingFields.length,
    });
    // Fase 2 — falha terminal vira problema (sino deduped por batch).
    if (
      outcome.status === "failed_permanent" ||
      outcome.status === "data_missing" ||
      outcome.status === "data_invalid"
    ) {
      await reportCertidaoProblem(job, outcome.errorMessage || outcome.status);
    }
    // F4: single-job path (retry/complementar) — check batch. For multi-job
    // batches from runBatch this is also called but is idempotent via batchId
    // metadata lookup.
    await checkBatchCompletion(job.batchId);
  } catch (err) {
    const latencyMs = Date.now() - startedAt.getTime();
    const message =
      err instanceof InfosimplesError
        ? `${err.message}`
        : err instanceof Error
        ? err.message
        : "erro desconhecido";
    // Phase F.II-α: classify this failure. InfosimplesError → provider-side
    // (likely network/timeout); AbortError → provider_timeout; anything else
    // (SyntaxError, TypeError, validation) → our side = integration_error.
    let failureCategory: string;
    if (err instanceof InfosimplesError) {
      failureCategory = message.toLowerCase().includes("timeout")
        ? "provider_timeout"
        : "portal_unavailable";
    } else if (err instanceof Error && err.name === "AbortError") {
      failureCategory = "provider_timeout";
    } else {
      failureCategory = "integration_error";
    }
    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        latencyMs,
        errorMessage: message.slice(0, 500),
        costCents: info.costCents,
        resultData: { failureCategory, errorMessage: message.slice(0, 500) },
      },
    });
    logTransition(jobId, "fetching", "failed", failureCategory, {
      endpoint: job.endpoint,
      errorMessage: message.slice(0, 200),
      latencyMs,
      costCents: info.costCents,
    });
    await reportCertidaoProblem(job, message.slice(0, 120));
    await checkBatchCompletion(job.batchId);
  }
}

/**
 * Runtime helper para resolver dados do consultado para renderização do PDF
 * Serasa. Carrega vendedores/compradores via SalesForm.dataJson (mesma fonte
 * que o planner usa) e diligenciados via DiligentedPerson. Cai num placeholder
 * mínimo quando o deal já não existe (job ad-hoc).
 */
async function resolveSerasaConsultado(
  dealId: string | null,
  targetKind: TargetKind,
  targetIndex: number
): Promise<SerasaRenderContext["consultado"]> {
  const fallback = {
    tipo: "Pessoa fisica" as const,
    label: `${targetKind} ${targetIndex + 1}`,
    documento: "—",
    kind: targetKind,
    index: targetIndex,
  };
  if (!dealId) return fallback;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { form: { select: { dataJson: true } } },
  });
  if (!deal) return fallback;

  if (targetKind === "diligenciado") {
    const dilig = await prisma.diligentedPerson.findMany({
      where: { dealId },
      orderBy: { createdAt: "asc" },
    });
    const row = dilig[targetIndex];
    if (!row) return fallback;
    return {
      tipo: row.tipoPessoa === "juridica" ? "Pessoa juridica" : "Pessoa fisica",
      label: row.nome,
      documento: (row.cnpj ?? row.cpf ?? "—") as string,
      uf: row.uf ?? undefined,
      kind: targetKind,
      index: targetIndex,
    };
  }

  const data = (deal.form?.dataJson ?? deal.dataJson) as Record<string, unknown> | null;
  const listKey =
    targetKind === "vendedor"
      ? "vendedores"
      : targetKind === "comprador"
      ? "compradores"
      : null;
  if (!listKey || !data) return fallback;
  const list = (data[listKey] as Array<Record<string, unknown>> | undefined) ?? [];
  const row = list[targetIndex];
  if (!row) return fallback;
  const isPJ = !!(row.cnpj as string | undefined);
  return {
    tipo: isPJ ? "Pessoa juridica" : "Pessoa fisica",
    label:
      ((row.razao_social ?? row.nome) as string | undefined) ?? fallback.label,
    documento: ((row.cnpj ?? row.cpf) as string | undefined) ?? "—",
    uf: (row.uf as string | undefined) ?? undefined,
    kind: targetKind,
    index: targetIndex,
  };
}

/**
 * Executa um CertidaoJob com `provider: "serasa"`.
 *
 * Fluxo:
 *   1. callSerasa(endpoint, payload) → JSON cru (OAuth2 + cache + retry 401/5xx
 *      já está dentro do client).
 *   2. normalizeSerasa(endpoint, body) → NormalizedResult (situacao + raw).
 *   3. renderSerasaHtml → exportPdfToBuffer → uploadBufferToStorage →
 *      DealAttachment { category: "certidao", source: "serasa" }.
 *   4. Update do CertidaoJob com status final e cost.
 *
 * Erros:
 *   - SerasaError com status conhecido → mapeia pra status do job (data_invalid
 *     em 422, rate_limited em 429, api_error em 5xx, failed em 4xx genérico).
 *   - Qualquer outra exceção → failed + integration_error.
 *
 * Diferença vs runSingleJob principal: Serasa NÃO emite PDF de portal, então
 * o pipeline pula `downloadAndAttach` (que assume site_receipts[]) e usa
 * geração própria via Puppeteer. Custos só são contabilizados em success —
 * em api_error/rate_limited zera pra retry honesto.
 */
async function runSerasaJob(
  job: { id: string; endpoint: string; label: string; targetKind: string; targetIndex: number; requestPayload: unknown; batchId: string; createdAt: Date },
  dealId: string | null,
  startedAt: Date
): Promise<void> {
  const info = endpointInfo(job.endpoint);
  try {
    const payload = (job.requestPayload as Record<string, unknown>) ?? {};
    const { body } = await callSerasa(job.endpoint, payload);
    const latencyMs = Date.now() - startedAt.getTime();

    const normalized = normalizeSerasa(job.endpoint, body);
    const consultado = await resolveSerasaConsultado(
      dealId,
      job.targetKind as TargetKind,
      job.targetIndex
    );

    // Gera PDF próprio (Serasa não devolve PDF) e anexa como DealAttachment.
    let attachmentId: string | null = null;
    if (dealId) {
      try {
        const html = renderSerasaHtml(normalized, {
          endpoint: job.endpoint,
          label: job.label,
          consultado,
        });
        const buffer = await exportPdfToBuffer(html);
        const safeName = `${job.endpoint.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}.pdf`;
        const url = await uploadBufferToStorage({
          bucket: process.env.S3_BUCKET,
          key: `deal-certidoes/${dealId}/${safeName}`,
          body: buffer,
          contentType: "application/pdf",
        });
        const assignmentKind =
          job.targetKind === "vendedor" ||
          job.targetKind === "comprador" ||
          job.targetKind === "imovel"
            ? job.targetKind
            : "outro";
        const attachment = await prisma.dealAttachment.create({
          data: {
            dealId,
            filename: safeName,
            mime: "application/pdf",
            url,
            category: "certidao",
            source: "serasa",
            extractedData: {
              certidao: { endpoint: job.endpoint, label: job.label },
              assignment: { kind: assignmentKind, index: job.targetIndex },
              serasa: { protocolo: (normalized.raw as Record<string, unknown> | undefined)?.protocolo ?? null },
            },
          },
        });
        attachmentId = attachment.id;
      } catch (renderErr) {
        // PDF é nice-to-have — perda de render NÃO invalida a consulta. Log e segue.
        console.error("[serasa] falha ao gerar PDF/anexo:", renderErr);
      }
    }

    await prisma.certidaoJob.update({
      where: { id: job.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        latencyMs,
        resultCode: 200,
        resultMessage: "ok",
        resultData: normalized as unknown as object,
        attachmentId,
        costCents: info.costCents,
      },
    });
    logTransition(job.id, "fetching", "success", "serasa ok", {
      endpoint: job.endpoint,
      situacao: normalized.situacao,
      latencyMs,
      costCents: info.costCents,
      hasAttachment: attachmentId !== null,
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt.getTime();
    const isSerasa = err instanceof SerasaError;
    const status = isSerasa ? err.status : 0;
    const message = err instanceof Error ? err.message : "erro desconhecido";

    // Roteamento por status HTTP. Retry transitório é deixado pro cron (status
    // api_error/rate_limited mantém nextRetryAt; failed_permanent é terminal).
    let jobStatus: JobStatus = "failed";
    let nextRetryAt: Date | null = null;
    let failureCategory = "integration_error";
    if (isSerasa) {
      if (status === 401) {
        // Auth quebrada — não dá pra retentar até alguém corrigir credenciais.
        failureCategory = "account_issue";
      } else if (status === 422 || status === 400) {
        jobStatus = "failed";
        failureCategory = "inconsistent_input";
      } else if (status === 429) {
        nextRetryAt = new Date(Date.now() + 30 * 60_000);
        failureCategory = "rate_limited";
      } else if (status >= 500) {
        nextRetryAt = new Date(Date.now() + 2 * 60_000);
        failureCategory = "provider_timeout";
      }
    }

    await prisma.certidaoJob.update({
      where: { id: job.id },
      data: {
        status: jobStatus,
        finishedAt: jobStatus === "failed" ? new Date() : null,
        latencyMs,
        resultCode: status || null,
        resultMessage: message.slice(0, 500),
        errorMessage: message.slice(0, 500),
        // Cobrança honesta: erros não geram custo (a Serasa só cobra resposta válida).
        costCents: 0,
        nextRetryAt,
        resultData: { failureCategory, errorMessage: message.slice(0, 500) },
      },
    });
    logTransition(job.id, "fetching", jobStatus, failureCategory, {
      endpoint: job.endpoint,
      errorMessage: message.slice(0, 200),
      latencyMs,
      status,
    });
  }
}

/**
 * Polls a single awaiting_portal job by calling the 'obter' counterpart.
 * Designed for the daily cron that sweeps TJSP/TJRJ jobs.
 */
export async function pollPortalJob(jobId: string): Promise<void> {
  const job = await prisma.certidaoJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "awaiting_portal") return;

  const pedidoData = (job.resultData as Record<string, unknown>) ?? {};
  const numeroPedido = pedidoData.numero_pedido as string | undefined;
  if (!numeroPedido) {
    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "numero_pedido ausente no job pedido",
      },
    });
    return;
  }

  // Resolve o endpoint do 2º passo a partir do prefixo do pedido. Antes só
  // tjsp/tjrj/trf3 eram mapeados — qualquer outro two-step (ONR matrícula,
  // TJMS, Antecedentes PF) caía em null e ficava preso em awaiting_portal.
  const obterEndpoint = resolveObterEndpoint(job.endpoint);
  if (!obterEndpoint) return;

  const obterInfo = endpointInfo(obterEndpoint);
  const startedAt = new Date();

  // Params do 2º passo variam por portal:
  //   - TJSP/TJRJ/TJMS: { numero_pedido }
  //   - TRF3: { numero_certidao, cpf|cnpj } (doc exige o documento junto)
  //   - ONR matrícula: { numero_pedido } no download da matrícula gerada
  //   - Antecedentes PF: { codigo, cpf } para validar o código emitido
  const payload = (job.requestPayload as Record<string, unknown>) ?? {};
  let obterArgs: Record<string, unknown> = { numero_pedido: numeroPedido };
  if (obterEndpoint.includes("/trf3/")) {
    obterArgs = { numero_certidao: numeroPedido };
    if (payload.cpf) obterArgs.cpf = payload.cpf;
    else if (payload.cnpj) obterArgs.cnpj = payload.cnpj;
  } else if (obterEndpoint.startsWith("antecedentes-criminais/")) {
    obterArgs = { codigo: numeroPedido };
    if (payload.cpf) obterArgs.cpf = payload.cpf;
  }

  // Fase 0 — guard de custo/crédito: não chama a API paga se a org está
  // bloqueada (orçamento mensal estourado ou crédito esgotado = 603 recente).
  // Evita martelar a API e queimar crédito. Reagenda dentro do prazo do portal;
  // se já estourou o prazo, vira problema.
  const blocked = await isOrgInfosimplesBlocked(job.orgId);
  if (blocked.blocked) {
    const reasonMsg =
      blocked.reason === "credit"
        ? "Crédito Infosimples esgotado — recarregue no portal"
        : "Orçamento mensal de certidões esgotado";
    if (Date.now() - job.createdAt.getTime() > maxPortalWaitMs(job.endpoint)) {
      await prisma.certidaoJob.update({
        where: { id: jobId },
        data: { status: "failed_permanent", finishedAt: new Date(), errorMessage: reasonMsg, portalUrl: job.portalUrl ?? obterInfo.portalUrl ?? null },
      });
      logTransition(jobId, "awaiting_portal", "failed_permanent", `blocked:${blocked.reason} + prazo esgotado`, { endpoint: obterEndpoint });
      await reportCertidaoProblem(job, blocked.reason === "credit" ? "crédito Infosimples esgotado" : "orçamento mensal esgotado");
      await checkBatchCompletion(job.batchId);
    } else {
      // Adia o poll ~1h sem chamar (não gasta) e avisa o problema.
      await prisma.certidaoJob.update({
        where: { id: jobId },
        data: { expectedReadyAt: new Date(Date.now() + 60 * 60_000), resultMessage: reasonMsg },
      });
      logTransition(jobId, "awaiting_portal", "awaiting_portal", `blocked:${blocked.reason} — poll adiado (sem chamada)`, { endpoint: obterEndpoint });
      await reportCertidaoProblem(job, blocked.reason === "credit" ? "crédito Infosimples esgotado" : "orçamento mensal esgotado");
    }
    return;
  }

  try {
    const resp = await callInfosimples(obterEndpoint, obterArgs);
    const latencyMs = Date.now() - startedAt.getTime();

    // Classifica a resposta do obter (2º passo) em vez de tratar todo 6xx como
    // "ainda processando" (loop infinito até 14d — bug que drenou crédito):
    //  - account/integration (603/604/602) → falha IMEDIATA (não reagenda) +
    //    problema. Não se resolve repetindo (token/crédito/endpoint inválido).
    //  - portal fora / limite (transitório) → retry limitado a maxRetries (3),
    //    depois falha + problema.
    //  - demais 6xx → "ainda processando": reagenda até o prazo do portal
    //    (maxPortalWaitMs), depois falha + problema.
    if (resp.code !== 200) {
      const category = mapInfosimplesCodeToCategory(resp.code, resp.code_message);
      const obterCost = resp.header?.billable === false ? 0 : obterInfo.costCents;
      const costAcc = (job.costCents ?? 0) + obterCost;
      const ageMs = startedAt.getTime() - job.createdAt.getTime();
      const portalUrl = job.portalUrl ?? obterInfo.portalUrl ?? null;
      const attempts = (job.retryCount ?? 0) + 1;
      const maxR = job.maxRetries ?? 3;
      const decision = decideObterOutcome(category, {
        ageMs,
        attempts,
        maxRetries: maxR,
        maxWaitMs: maxPortalWaitMs(job.endpoint),
      });

      if (decision.action === "fail") {
        const reasonMsg: Record<typeof decision.reason, string> = {
          account: "crédito/conta Infosimples",
          integration: "endpoint indisponível",
          transient_exhausted: "portal indisponível (tentativas esgotadas)",
          deadline: "prazo do portal esgotado",
        };
        await prisma.certidaoJob.update({
          where: { id: jobId },
          data: {
            status: "failed_permanent",
            finishedAt: new Date(),
            retryCount: attempts,
            resultCode: resp.code,
            resultMessage: resp.code_message,
            errorMessage: `${reasonMsg[decision.reason]}: ${resp.code_message ?? ""}`.slice(0, 500),
            costCents: costAcc,
            portalUrl,
          },
        });
        logTransition(jobId, "awaiting_portal", "failed_permanent", `obter ${decision.reason}`, {
          endpoint: obterEndpoint,
          resultCode: resp.code,
          attempts,
          ageMs,
        });
        await reportCertidaoProblem(job, reasonMsg[decision.reason]);
        await checkBatchCompletion(job.batchId);
        return;
      }

      // retry (transitório, conta tentativa) ou wait (ainda processando, não
      // conta) — ambos reagendam dentro do prazo do portal.
      const next = new Date(Date.now() + computeAdaptiveRetryDelta(job.endpoint, job.createdAt));
      await prisma.certidaoJob.update({
        where: { id: jobId },
        data: {
          expectedReadyAt: next,
          resultCode: resp.code,
          resultMessage: resp.code_message,
          costCents: costAcc,
          ...(decision.action === "retry" ? { retryCount: attempts } : {}),
        },
      });
      logTransition(
        jobId,
        "awaiting_portal",
        "awaiting_portal",
        decision.action === "retry"
          ? `obter transitório — retry ${attempts}/${maxR}`
          : "portal still processing — rescheduled",
        { endpoint: obterEndpoint, resultCode: resp.code, nextCheck: next }
      );
      return;
    }

    const normalized = normalize(obterEndpoint, resp);
    let attachmentId: string | null = null;
    const receipt = resp.site_receipts?.[0];
    if (receipt && resp.code === 200) {
      attachmentId = await downloadAndAttach(
        job.dealId,
        obterEndpoint,
        job.label,
        receipt,
        job.targetKind,
        job.targetIndex
      );
    }

    const enrichedObterData: Record<string, unknown> = {
      ...(normalized as unknown as Record<string, unknown>),
    };
    if (receipt) enrichedObterData._rawReceipt = receipt;

    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "success",
        finishedAt: new Date(),
        latencyMs,
        resultCode: resp.code,
        resultMessage: resp.code_message,
        resultData: enrichedObterData as object,
        attachmentId,
        costCents: (job.costCents ?? 0) + obterInfo.costCents,
      },
    });
    logTransition(jobId, "awaiting_portal", "success", "portal delivered", {
      endpoint: obterEndpoint,
      resultCode: resp.code,
      situacao: (normalized as { situacao?: string }).situacao,
      latencyMs,
      hasAttachment: attachmentId !== null,
    });
    // F4: portal job just became terminal — check if the whole batch is done
    await checkBatchCompletion(job.batchId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: message.slice(0, 500),
      },
    });
    logTransition(jobId, "awaiting_portal", "failed", "poll exception", {
      endpoint: obterEndpoint,
      errorMessage: message.slice(0, 200),
    });
    // F4: failure is also a terminal state — check batch
    await checkBatchCompletion(job.batchId);
  }
}

/**
 * Encadeia o 2º passo de detalhes SP do CENPROT Nacional. A resposta de
 * `ieptb/protestos` traz um ou mais tokens `obter_detalhes` (cartórios de SP);
 * para cada um chamamos `ieptb/protestos-detalhes-sp`, anexamos o PDF e
 * acumulamos o detalhe normalizado. Best-effort: qualquer falha é logada e não
 * altera o status do job nacional.
 */
async function fetchCenprotDetalhesSp(
  nacionalResp: InfosimplesResponse,
  job: { endpoint: string; label: string; targetKind: string; targetIndex: number },
  dealId: string | null
): Promise<{ detalhesSp: unknown[]; extraCostCents: number }> {
  const tokens = collectObterDetalhesTokens(nacionalResp);
  if (tokens.length === 0) return { detalhesSp: [], extraCostCents: 0 };

  const detEndpoint = "ieptb/protestos-detalhes-sp";
  const detInfo = endpointInfo(detEndpoint);
  const detalhesSp: unknown[] = [];
  let extraCostCents = 0;

  for (const token of tokens) {
    try {
      const resp = await callInfosimples(detEndpoint, { obter_detalhes: token });
      if (resp.code !== 200) {
        console.error(
          `[certidoes] detalhes-sp code ${resp.code}: ${resp.code_message}`
        );
        continue;
      }
      extraCostCents += detInfo.costCents;
      const normalized = normalize(detEndpoint, resp);
      const receipt = resp.site_receipts?.[0];
      let attachmentId: string | null = null;
      if (receipt) {
        attachmentId = await downloadAndAttach(
          dealId,
          detEndpoint,
          `${job.label} — detalhes SP`,
          receipt,
          job.targetKind,
          job.targetIndex
        );
      }
      detalhesSp.push({
        obter_detalhes: token,
        ...(normalized as unknown as Record<string, unknown>),
        attachmentId,
      });
    } catch (err) {
      console.error("[certidoes] falha no detalhes-sp CENPROT:", err);
    }
  }
  return { detalhesSp, extraCostCents };
}

/**
 * Varre a resposta nacional em busca de tokens `obter_detalhes` (cartórios SP),
 * de forma defensiva e recursiva, deduplicando. O shape exato da resposta
 * Infosimples deve ser confirmado em QA — esta varredura tolera tanto tokens no
 * topo quanto aninhados por protesto/cartório.
 */
function collectObterDetalhesTokens(resp: InfosimplesResponse): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "obter_detalhes" && typeof value === "string" && value.trim()) {
        found.add(value.trim());
      } else {
        visit(value);
      }
    }
  };
  visit(resp.data);
  return Array.from(found);
}

async function downloadAndAttach(
  dealId: string | null,
  endpoint: string,
  label: string,
  receiptUrl: string,
  targetKind: string,
  targetIndex: number
): Promise<string | null> {
  // Phase C: ad-hoc jobs have no dealId — skip DealAttachment creation and
  // let the UI consume site_receipts[] directly from the Infosimples result.
  // This avoids a broader schema change (DealAttachment.dealId nullable)
  // while still letting ad-hoc users download the PDFs via the original URL.
  if (!dealId) return null;
  try {
    const { buffer, contentType } = await downloadReceipt(receiptUrl);
    const safeName = `${endpoint.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}.pdf`;
    const bucket = process.env.S3_BUCKET;
    const key = `deal-certidoes/${dealId}/${safeName}`;
    const url = await uploadBufferToStorage({
      bucket,
      key,
      body: buffer,
      contentType,
    });
    // Persist assignment so DocumentsTab groups certidao attachments by part/imovel
    const assignmentKind =
      targetKind === "vendedor" || targetKind === "comprador" || targetKind === "imovel"
        ? targetKind
        : "outro";
    const attachment = await prisma.dealAttachment.create({
      data: {
        dealId,
        filename: safeName,
        mime: contentType,
        url,
        category: "certidao",
        source: "infosimples",
        extractedData: {
          certidao: { endpoint, label },
          assignment: { kind: assignmentKind, index: targetIndex },
        },
      },
    });
    return attachment.id;
  } catch (err) {
    console.error("[certidoes] falha ao baixar comprovante", err);
    return null;
  }
}

/**
 * Dead-man sweeper — resolves jobs stuck in non-terminal states when their
 * container has clearly died (started more than `staleAfterMs` ago).
 *
 * CRITICAL: this function never overwrites a valid result. If the sweeper
 * finds a zombie job that has already persisted valid result data (resultCode
 * 200 + resultData.situacao in a terminal state), it PROMOTES the job to
 * status="success" instead of marking as failed. This protects against the
 * race where the container finished the Prisma update for resultData but died
 * before returning HTTP to the polling client — the data is in the DB, the
 * job row just looks stuck.
 *
 * Runs hourly via cron. Also exposed via /api/deals/:id/certidoes/sweep for
 * per-deal manual sweeps.
 *
 * Returns `{ promoted, failed }` counts.
 */
export async function sweepStaleJobs(options: {
  dealId?: string;
  staleAfterMs?: number;
} = {}): Promise<{ promoted: number; failed: number }> {
  const staleAfter = options.staleAfterMs ?? 15 * 60_000; // 15 min default
  const cutoff = new Date(Date.now() - staleAfter);

  const stale = await prisma.certidaoJob.findMany({
    where: {
      ...(options.dealId ? { dealId: options.dealId } : {}),
      status: { in: ["fetching", "pending"] },
      OR: [
        { startedAt: { lt: cutoff } },
        { AND: [{ startedAt: null }, { createdAt: { lt: cutoff } }] },
      ],
    },
    select: {
      id: true,
      batchId: true,
      resultCode: true,
      resultData: true,
      attachmentId: true,
    },
  });

  if (stale.length === 0) return { promoted: 0, failed: 0 };

  const TERMINAL_SITUACOES = new Set([
    "negativa",
    "positiva",
    "positiva_com_efeitos",
    "nao_emitida",
    "aguardando_pdf",
    // Serasa: jobs com resultData persistido + situacao terminal são promovidos
    // pelo sweeper igual aos Infosimples (resolve race container-morto-pós-update).
    "sem_restricao",
    "com_restricao",
    "informativa",
  ]);

  const toPromote: string[] = [];
  const toFail: string[] = [];

  for (const job of stale) {
    const data = job.resultData as { situacao?: string } | null;
    const hasValidResult =
      job.resultCode === 200 &&
      data != null &&
      typeof data.situacao === "string" &&
      TERMINAL_SITUACOES.has(data.situacao);
    if (hasValidResult) {
      toPromote.push(job.id);
    } else {
      toFail.push(job.id);
    }
  }

  const now = new Date();

  if (toPromote.length > 0) {
    await prisma.certidaoJob.updateMany({
      where: { id: { in: toPromote } },
      data: {
        status: "success",
        finishedAt: now,
      },
    });
  }

  if (toFail.length > 0) {
    await prisma.certidaoJob.updateMany({
      where: { id: { in: toFail } },
      data: {
        status: "failed",
        finishedAt: now,
        errorMessage:
          "Timeout — container reciclado antes de concluir a consulta. Clique em tentar novamente.",
      },
    });
  }

  // F4: check batch completion for every unique batch touched by the sweep
  const touchedBatchIds = Array.from(new Set(stale.map((j) => j.batchId)));
  for (const batchId of touchedBatchIds) {
    await checkBatchCompletion(batchId);
  }

  return { promoted: toPromote.length, failed: toFail.length };
}

/**
 * Budget guard — returns current month spent for the given org and whether we
 * are over budget. Budget is per-org to isolate tenants — one org's spend does
 * not consume another org's quota.
 *
 * **Importante (Serasa integration, 2026-05):** este helper conta APENAS jobs
 * Infosimples. Sem o filtro, jobs Serasa (ticket muito maior — R$ 5 vs R$ 0,04)
 * estourariam o budget Infosimples e bloqueariam certidões legítimas. Use
 * `getMonthlySpendByProvider` para Serasa.
 */
export async function getMonthlySpend(orgId: string): Promise<{
  spentCents: number;
  budgetCents: number;
  exceeded: boolean;
}> {
  return getMonthlySpendByProvider(orgId, "infosimples");
}

/**
 * Budget guard generalizado por provider.
 *
 * - `infosimples` → INFOSIMPLES_MONTHLY_BUDGET_CENTS (default R$ 200)
 * - `serasa`      → SERASA_MONTHLY_BUDGET_CENTS (default R$ 5.000)
 *
 * Mantemos budgets isolados porque os tickets são muito diferentes — Serasa
 * R$ 5 por consulta vs Infosimples R$ 0,04. Compartilhar caixa sufoca um ou
 * outro dependendo de onde a org puxa mais.
 */
export async function getMonthlySpendByProvider(
  orgId: string,
  provider: "infosimples" | "serasa"
): Promise<{ spentCents: number; budgetCents: number; exceeded: boolean }> {
  const budgetCents =
    provider === "serasa"
      ? Number(process.env.SERASA_MONTHLY_BUDGET_CENTS ?? "500000")
      : Number(process.env.INFOSIMPLES_MONTHLY_BUDGET_CENTS ?? "20000");
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = await prisma.certidaoJob.aggregate({
    where: {
      createdAt: { gte: firstOfMonth },
      provider,
      deal: { form: { orgId } },
    },
    _sum: { costCents: true },
  });
  const spentCents = agg._sum.costCents ?? 0;
  return { spentCents, budgetCents, exceeded: spentCents >= budgetCents };
}

// Re-export for external callers
export { JobStatus };
