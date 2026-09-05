/**
 * Runner da análise de crédito Ficha Certa — o lado assíncrono do
 * `CreditAnalysisRequest` (1 solicitação na Ficha Certa) e dos seus
 * `CertidaoJob` (1 por pretendente, `provider: "fichacerta"`).
 *
 *   submitCreditRequest   pending → submitting → processing
 *                         (cria solicitação + pretendentes + pede o laudo;
 *                          jobs → awaiting_portal)
 *   reconcileCreditRequest processing → completed | failed
 *                         (GET report; pretendente concluído → job success;
 *                          tudo terminal → PDF do laudo anexado à proposta)
 *
 * Idempotência: CAS no status do request; `pretendente_id` gravado job a job
 * (retry não recria quem já existe); `updateKey` por pretendente (reentrega
 * do webhook não reescreve). `resultData.numero_pedido = id da solicitação`
 * de propósito — é o que `isInProgressBlocking` lê para tratar
 * `awaiting_portal` como "em andamento de verdade", e o cron `poll-portal`
 * pega esses jobs por `expectedReadyAt` sem mudança.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requireFichaCertaCreds, type FichaCertaCreds } from "@/lib/fichacerta/account";
import {
  addApplicant,
  createSolicitation,
  downloadReportPdf,
  getReport,
  getSolicitation,
  requestReport,
} from "@/lib/fichacerta/client";
import {
  FichaCertaError,
  type LocacaoInput,
  type PretendenteInput,
  type ReportPretendente,
  type ReportResponse,
} from "@/lib/fichacerta/types";
import {
  isPretendenteConcluido,
  normalizeFichaCertaLaudo,
  pretendenteUpdateKey,
} from "@/lib/fichacerta/normalize";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { checkBatchCompletion, reportCertidaoProblem } from "@/lib/certidoes/executor";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { persistProposalDocument } from "@/lib/proposals/attachments";

export const FICHACERTA_MAX_WAIT_MS = (() => {
  const n = Number(process.env.FICHACERTA_MAX_WAIT_MS ?? 72 * 3600 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 72 * 3600 * 1000;
})();
const REARM_MS = 30 * 60_000;
const RETRY_AFTER_MS = 10 * 60_000;

export interface CreditRequestJson {
  locacao: LocacaoInput;
  produtos: number[];
  produtosPj?: number[];
}

interface JobResult {
  solicitacao_id?: number;
  pretendente_id?: number;
  numero_pedido?: string;
  updateKey?: string;
  situacao?: string;
  detalhes?: string | null;
  emissao?: string;
  raw?: unknown;
  [k: string]: unknown;
}

const AWAITING = ["pending", "fetching", "submitting", "awaiting_portal"];
/** Estados que uma falha do envio pode sobrescrever — inclui o retry (`api_error`). */
const FAILABLE = [...AWAITING, "api_error"];

const digits = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");

function jobResult(job: { resultData: unknown }): JobResult {
  return (job.resultData && typeof job.resultData === "object" ? (job.resultData as JobResult) : {}) ?? {};
}

function isPjPayload(p: PretendenteInput): boolean {
  return p.tipo_pretendente === "OUTROS";
}

/**
 * Localiza o pretendente na solicitação pelo CPF/CNPJ (a API de criação só
 * devolve o id da solicitação). Casamento EXATO; só aceita o único da lista
 * quando há um só — nunca "o primeiro" de vários, que atribuiria o laudo de
 * uma pessoa ao job de outra. Também é o que torna o retry idempotente: quem
 * já está na solicitação é reaproveitado em vez de adicionado de novo.
 */
async function findApplicantId(creds: FichaCertaCreds, sid: number, payload: PretendenteInput): Promise<number | null> {
  const det = await getSolicitation(creds, sid);
  const list = det.data?.pretendentes ?? [];
  const want = payload.tipo_pretendente === "OUTROS" ? digits(payload.cnpj) : digits(payload.cpf);
  const exact = want ? list.find((x) => (digits(x.cpf) || digits(x.cnpj)) === want) : undefined;
  // Único da lista só vale quando a API não devolve documento nenhum (não há
  // como casar); se devolve e não bate, é OUTRA pessoa — não é a nossa.
  const lone = list.length === 1 && !(digits(list[0].cpf) || digits(list[0].cnpj)) ? list[0] : undefined;
  const hit = exact ?? lone;
  return typeof hit?.id === "number" ? hit.id : null;
}

async function failJobs(
  jobIds: string[],
  status: "failed" | "failed_permanent" | "api_error",
  message: string,
  extra: Prisma.CertidaoJobUpdateManyMutationInput = {}
) {
  if (jobIds.length === 0) return;
  await prisma.certidaoJob.updateMany({
    where: { id: { in: jobIds }, status: { in: FAILABLE } },
    data: {
      status,
      errorMessage: message.slice(0, 500),
      ...(status === "api_error" ? { nextRetryAt: new Date(Date.now() + RETRY_AFTER_MS) } : { finishedAt: new Date() }),
      ...extra,
    },
  });
}

/**
 * pending → submitting → processing. Devolve `{ ok: false, reason }` sem
 * lançar: o caller (rota via waitUntil, executor) não tem o que fazer com a
 * exceção, e o estado já ficou gravado nos jobs.
 */
export async function submitCreditRequest(
  requestId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const claimed = await prisma.creditAnalysisRequest.updateMany({
    where: { id: requestId, status: "pending" },
    data: { status: "submitting" },
  });
  if (claimed.count === 0) return { ok: false, reason: "not_pending" };

  const request = await prisma.creditAnalysisRequest.findUnique({
    where: { id: requestId },
    include: { jobs: { orderBy: { createdAt: "asc" } } },
  });
  if (!request) return { ok: false, reason: "not_found" };
  const jobs = request.jobs.filter((j) => AWAITING.includes(j.status) || j.status === "api_error");
  const first = jobs[0];
  const back = async (status: string, errorMessage: string | null) =>
    prisma.creditAnalysisRequest.update({ where: { id: requestId }, data: { status, errorMessage } });

  let creds: FichaCertaCreds;
  try {
    creds = await requireFichaCertaCreds(request.orgId);
  } catch {
    await failJobs(jobs.map((j) => j.id), "failed_permanent", "Conta Ficha Certa não conectada nesta imobiliária");
    await back("failed", "Conta Ficha Certa não conectada");
    if (first) await checkBatchCompletion(first.batchId);
    return { ok: false, reason: "not_configured" };
  }

  const rj = (request.requestJson ?? {}) as unknown as CreditRequestJson;
  const produtos = Array.isArray(rj.produtos) && rj.produtos.length > 0 ? rj.produtos : creds.products;
  const produtosPj = Array.isArray(rj.produtosPj) && rj.produtosPj.length > 0 ? rj.produtosPj : [4];

  try {
    let sid = request.externalId ? Number(request.externalId) : null;
    for (const job of jobs) {
      const stored = jobResult(job);
      if (stored.pretendente_id) continue;
      const payload = job.requestPayload as unknown as PretendenteInput;
      const prods = isPjPayload(payload) ? produtosPj : produtos;
      let pid: number | null = null;
      if (sid == null) {
        const created = await createSolicitation(creds, { produtos: prods, locacao: rj.locacao, pretendente: payload });
        sid = created.id;
        await prisma.creditAnalysisRequest.update({
          where: { id: requestId },
          data: { externalId: String(sid), submittedAt: request.submittedAt ?? new Date() },
        });
        pid = await findApplicantId(creds, sid, payload);
      } else {
        // Solicitação já existe (retry): quem já está nela é reaproveitado —
        // sem isto um retry depois de `createSolicitation` + queda de rede
        // adicionava o 1º pretendente de novo (cobrado, órfão).
        pid = await findApplicantId(creds, sid, payload);
        if (pid == null) {
          const created = await addApplicant(creds, sid, { produtos: prods, pretendente: payload });
          pid = created.id;
        }
      }
      if (pid == null) {
        // Não sabemos qual pessoa é a nossa: falha retentável (o próximo
        // retry casa por CPF/CNPJ), nunca "chuta" um id.
        throw new Error(`Pretendente não localizado na solicitação ${sid}`);
      }
      await prisma.certidaoJob.update({
        where: { id: job.id },
        data: {
          resultData: {
            ...stored,
            solicitacao_id: sid,
            pretendente_id: pid,
            numero_pedido: String(sid),
          } as Prisma.InputJsonValue,
        },
      });
    }
    if (sid == null) {
      await back("failed", "Nenhum pretendente para enviar");
      return { ok: false, reason: "no_applicants" };
    }
    await requestReport(creds, sid);

    const waitMin = first ? (endpointInfo(first.endpoint).expectedWaitMinutes ?? 30) : 30;
    const now = new Date();
    await prisma.certidaoJob.updateMany({
      where: { creditRequestId: requestId, status: { in: ["pending", "fetching", "submitting", "api_error"] } },
      data: {
        status: "awaiting_portal",
        startedAt: now,
        expectedReadyAt: new Date(now.getTime() + waitMin * 60_000),
        errorMessage: null,
        nextRetryAt: null,
      },
    });
    await prisma.creditAnalysisRequest.update({
      where: { id: requestId },
      data: { status: "processing", submittedAt: request.submittedAt ?? now, errorMessage: null, lastSyncedAt: now },
    });
    return { ok: true };
  } catch (err) {
    const status = err instanceof FichaCertaError ? err.status : 0;
    const msg = err instanceof Error ? err.message : String(err);
    const ids = jobs.map((j) => j.id);
    if (status === 401 || status === 403) {
      await failJobs(ids, "failed_permanent", `Ficha Certa recusou a credencial (${status}): ${msg}`);
      await back("failed", `Credencial recusada (${status})`);
      if (first) await reportCertidaoProblem(first, "credencial da Ficha Certa recusada");
    } else if (status === 422 || status === 404) {
      await failJobs(ids, "failed", `Ficha Certa recusou a solicitação (${status}): ${msg}`);
      await back("failed", msg.slice(0, 500));
    } else {
      // 5xx / timeout / rede: retentável — o cron re-executa por nextRetryAt e
      // o CAS pending→submitting deixa o request pronto para isso.
      await failJobs(ids, "api_error", `Ficha Certa indisponível: ${msg}`);
      await back("pending", msg.slice(0, 500));
    }
    if (first) await checkBatchCompletion(first.batchId);
    return { ok: false, reason: `error_${status}` };
  }
}

export interface ReconcileOptions {
  source: "webhook" | "poll" | "manual";
  /** Payload do webhook (só o pretendente que concluiu) — usado se o GET falhar. */
  payload?: ReportResponse;
}

/** Aplica o laudo de UM pretendente ao job casado por `pretendente_id`. Devolve se mudou. */
async function applyPretendente(
  sid: number,
  pret: ReportPretendente,
  jobs: Array<{ id: string; status: string; resultData: unknown; batchId: string; endpoint: string; label: string; orgId: string | null; dealId: string | null; proposalId: string | null }>,
  costCents: number
): Promise<boolean> {
  const pid = pret.pessoa?.id;
  if (typeof pid !== "number") return false;
  const job = jobs.find((j) => jobResult(j).pretendente_id === pid);
  if (!job) return false;
  const stored = jobResult(job);
  const key = pretendenteUpdateKey(sid, pret);
  if (job.status === "success" && stored.updateKey === key) return false;
  if (!isPretendenteConcluido(pret)) return false;
  const normalized = normalizeFichaCertaLaudo(pret);
  await prisma.certidaoJob.update({
    where: { id: job.id },
    data: {
      status: "success",
      resultCode: 200,
      finishedAt: new Date(),
      errorMessage: null,
      nextRetryAt: null,
      costCents,
      resultData: {
        ...stored,
        updateKey: key,
        situacao: normalized.situacao,
        detalhes: normalized.detalhes ?? null,
        ...(normalized.emissao ? { emissao: normalized.emissao } : {}),
        raw: normalized.raw,
      } as Prisma.InputJsonValue,
    },
  });
  return true;
}

/**
 * processing → completed | failed. Sempre re-arma `expectedReadyAt` de quem
 * continua aguardando (o cron volta), e desiste em `FICHACERTA_MAX_WAIT_MS`.
 */
export async function reconcileCreditRequest(requestId: string, opts: ReconcileOptions): Promise<void> {
  const request = await prisma.creditAnalysisRequest.findUnique({
    where: { id: requestId },
    include: { jobs: true },
  });
  if (!request || !request.externalId) return;
  if (request.status !== "processing" && request.status !== "completed") return;
  const sid = Number(request.externalId);
  let creds: FichaCertaCreds;
  try {
    creds = await requireFichaCertaCreds(request.orgId);
  } catch {
    return;
  }

  let report: ReportResponse | null = null;
  try {
    report = await getReport(creds, sid);
  } catch (err) {
    console.warn(`[fichacerta] getReport ${sid} falhou (${opts.source}):`, err instanceof Error ? err.message : err);
    report = opts.payload ?? null;
  }
  const now = Date.now();
  let changed = false;
  for (const pret of report?.pretendentes ?? []) {
    if (await applyPretendente(sid, pret, request.jobs, creds.costCents)) changed = true;
  }

  const fresh = await prisma.certidaoJob.findMany({ where: { creditRequestId: requestId } });
  const waiting = fresh.filter((j) => j.status === "awaiting_portal");
  if (waiting.length > 0) {
    const started = (request.submittedAt ?? request.createdAt).getTime();
    if (now - started > FICHACERTA_MAX_WAIT_MS) {
      await prisma.certidaoJob.updateMany({
        where: { id: { in: waiting.map((j) => j.id) } },
        data: { status: "failed_permanent", finishedAt: new Date(), errorMessage: "Laudo não concluído no prazo — verifique no portal da Ficha Certa" },
      });
      await reportCertidaoProblem(waiting[0], "laudo da Ficha Certa não concluído no prazo");
      changed = true;
    } else {
      await prisma.certidaoJob.updateMany({
        where: { id: { in: waiting.map((j) => j.id) } },
        data: { expectedReadyAt: new Date(now + REARM_MS) },
      });
    }
  }

  const still = await prisma.certidaoJob.count({ where: { creditRequestId: requestId, status: { in: AWAITING } } });
  if (still === 0) {
    await finalizeRequest(request.id, request.proposalId, sid, creds, report, fresh);
  } else {
    await prisma.creditAnalysisRequest.update({ where: { id: requestId }, data: { lastSyncedAt: new Date() } });
  }
  if (changed && fresh[0]) await checkBatchCompletion(fresh[0].batchId);
}

async function finalizeRequest(
  requestId: string,
  proposalId: string | null,
  sid: number,
  creds: FichaCertaCreds,
  report: ReportResponse | null,
  jobs: Array<{ status: string; costCents: number | null }>
): Promise<void> {
  const current = await prisma.creditAnalysisRequest.findUnique({ where: { id: requestId } });
  if (!current) return;
  let reportProposalAttachmentId = current.reportProposalAttachmentId;
  let reportUrl = current.reportUrl;
  const anySuccess = jobs.some((j) => j.status === "success");
  // PDF do laudo uma vez só, e só quando há laudo (sem sucesso não há PDF).
  if (anySuccess && !reportProposalAttachmentId && proposalId) {
    try {
      const buffer = await downloadReportPdf(creds, sid);
      const key = `proposal-laudos/${proposalId}/laudo_fichacerta_${sid}_${Date.now()}.pdf`;
      const url = await uploadBufferToStorage({ bucket: process.env.S3_BUCKET, key, body: buffer, contentType: "application/pdf" });
      const { attachment } = await persistProposalDocument({
        proposalId,
        buffer,
        url,
        filename: `Laudo_FichaCerta_${sid}.pdf`,
        mime: "application/pdf",
        category: "laudo_credito",
        source: "fichacerta",
        status: "ready",
        extractedData: { assignment: { kind: "outro", index: 0 }, assignmentPersisted: true, laudo: { solicitacaoId: sid } },
      });
      reportProposalAttachmentId = attachment.id;
      reportUrl = url;
    } catch (err) {
      console.error(`[fichacerta] PDF do laudo ${sid} falhou:`, err instanceof Error ? err.message : err);
    }
  }
  const costCents = jobs.reduce((acc, j) => acc + (j.costCents ?? 0), 0);
  await prisma.creditAnalysisRequest.update({
    where: { id: requestId },
    data: {
      status: anySuccess ? "completed" : "failed",
      completedAt: new Date(),
      lastSyncedAt: new Date(),
      resultJson: (report?.parecer ?? {}) as Prisma.InputJsonValue,
      reportProposalAttachmentId,
      reportUrl,
      costCents,
      ...(anySuccess ? { errorMessage: null } : {}),
    },
  });
}

/** Entrada do executor (`runSingleJob`) para um job `provider: "fichacerta"`. */
export async function runFichaCertaJob(job: { id: string; creditRequestId: string | null; batchId: string }): Promise<void> {
  if (!job.creditRequestId) {
    await prisma.certidaoJob.update({
      where: { id: job.id },
      data: { status: "failed_permanent", finishedAt: new Date(), errorMessage: "Job de análise de crédito sem solicitação associada" },
    });
    return;
  }
  const r = await submitCreditRequest(job.creditRequestId);
  if (!r.ok && r.reason === "not_pending") {
    // Já enviado (retry de job avulso): o que cabe é reconciliar.
    await reconcileCreditRequest(job.creditRequestId, { source: "poll" });
  }
}

/** Entrada do `pollPortalJob` (cron) para um job `awaiting_portal` da Ficha Certa. */
export async function pollFichaCertaJob(job: { creditRequestId: string | null }): Promise<void> {
  if (!job.creditRequestId) return;
  await reconcileCreditRequest(job.creditRequestId, { source: "poll" });
}
