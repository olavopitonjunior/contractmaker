import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal, diligentedPersonToInput } from "@/lib/certidoes/planner";
import { runBatch, getMonthlySpend, getMonthlySpendByProvider } from "@/lib/certidoes/executor";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { isInProgressBlocking } from "@/lib/certidoes/lifecycle";
import { sanitizePayload } from "@/lib/certidoes/infosimples";
import { sanitizeSerasaPayload } from "@/lib/serasa/sanitize";
import { checkGovBrAuth } from "@/lib/certidoes/govbr-auth";
import { checkOnrAuth } from "@/lib/certidoes/onr-auth";
import { audit } from "@/lib/security/audit";
import { z } from "zod";

export const runtime = "nodejs";
// maxDuration deve ser > DEFAULT_TIMEOUT_MS (630s) do callInfosimples para que
// o Vercel nao recicle o container antes do fetch timeout.
export const maxDuration = 660;

async function authorizeDeal(dealId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized", status: 401 as const };
  const org = await getUserOrg(session.user.id);
  if (!org) return { error: "No organization", status: 400 as const };
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      form: { select: { orgId: true, dataJson: true } },
    },
  });
  if (!deal) return { error: "Deal not found", status: 404 as const };
  if (deal.form && deal.form.orgId !== org.id) {
    return { error: "Forbidden", status: 403 as const };
  }
  return {
    deal,
    org,
    userId: session.user.id,
    userEmail: session.user.email ?? null,
  };
}

/**
 * GET /api/deals/:dealId/certidoes?batchId=xxx
 * Lists jobs (optionally scoped to a batch).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await authorizeDeal(params.dealId);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  const jobs = await prisma.certidaoJob.findMany({
    where: {
      dealId: params.dealId,
      ...(batchId ? { batchId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      attachment: { select: { id: true, filename: true, mime: true } },
    },
  });

  // derive latest batch meta
  const latestBatchId = jobs[0]?.batchId;
  return NextResponse.json({
    jobs,
    latestBatchId,
  });
}

const extractSchema = z.object({
  batchId: z.string().min(8),
  // F2: explicit job selection. If provided, only these jobs are extracted.
  // If omitted, the full default plan runs (backwards-compat with R5 callers).
  jobs: z
    .array(
      z.object({
        endpoint: z.string(),
        targetKind: z.enum([
          "vendedor",
          "comprador",
          "imovel",
          "diligenciado",
          "conjuge_vendedor",
          "procurador_vendedor",
          "representante_vendedor",
        ]),
        targetIndex: z.number().int().min(0),
      })
    )
    .optional(),
  // Legacy field, no longer used — kept for backwards-compat parse safety
  jobEndpoints: z.array(z.string()).optional(),
});

/**
 * POST /api/deals/:dealId/certidoes
 * Body: { batchId, jobs? } — creates jobs from the planner and fires the executor.
 *
 * Two modes:
 *   1. Default plan (no `jobs` field): runs planCertidoesForDeal and extracts
 *      everything it suggests. R5-compatible behavior.
 *   2. Explicit selection (F2): runs planner with `expandAll=true` to generate
 *      the full possible job list (including other UFs), then filters by the
 *      user's selection. Allows granular opt-in/out + "extras" picker support.
 *
 * The client generates batchId upfront and starts polling GET immediately.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await authorizeDeal(params.dealId);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { deal, org, userId, userEmail } = authResult;

  const body = await req.json().catch(() => ({}));
  const parsed = extractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { batchId, jobs: selectedJobs } = parsed.data;

  // A trava de "extração em andamento" passou a ser POR ALVO (endpoint+parte),
  // não mais por deal inteiro — ver a partição toDispatch/skippedInProgress
  // logo após montar effectiveJobs. Erro/instabilidade são retentáveis na hora;
  // só o alvo genuinamente em andamento (pending/fetching recente ou
  // awaiting_portal com protocolo) bloqueia um novo disparo do MESMO alvo.

  // Budget guard (per-org, per-provider). Verificamos ambos os budgets aqui
  // porque o batch pode misturar Infosimples e Serasa; cap separado evita que
  // Serasa (ticket alto) bloqueie Infosimples e vice-versa.
  const spend = await getMonthlySpend(org.id);
  const serasaSpend = await getMonthlySpendByProvider(org.id, "serasa");
  if (spend.exceeded) {
    return NextResponse.json(
      { error: "Budget mensal de certidoes Infosimples atingido", spend },
      { status: 402 }
    );
  }

  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ||
    (deal.dataJson as Record<string, unknown> | null);

  // F3: load diligenciados so the planner can include them as targets
  const diligenciadosRaw = await prisma.diligentedPerson.findMany({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "asc" },
  });
  const diligenciados = diligenciadosRaw.map(diligentedPersonToInput);

  // Phase F.II-γ — pre-flight GOV.BR (cached 5min) para decidir se endpoints
  // `requiresGovBrAuth` (CENPROT nacional) disparam ou viram SkippedJob.
  const govbr = await checkGovBrAuth();
  // Phase L — pre-flight ONR (matrícula, pesquisa de bens). Sem credenciais
  // configuradas, esses endpoints viram SkippedJob no planner.
  const onr = await checkOnrAuth();

  // F2: if explicit selection provided, run planner with expandAll so we can
  // match any (endpoint, target) combo the user asked for — including
  // cross-UF picks. Otherwise use the default auto-plan.
  const plan = planCertidoesForDeal(
    dealData as any,
    // E-mail do operador → vai pro campo `email` dos jobs de tribunal (TJSP/
    // TJRJ/TJ), que o e-SAJ valida e usa pra notificar a certidão. Antes ia
    // `undefined` → caía no DEFAULT_EMAIL morto e o portal recusava com 608.
    userEmail ?? undefined,
    diligenciados,
    {
      expandAll: !!selectedJobs,
      govBrActive: govbr.active,
      onrActive: onr.active,
    }
  );

  // F2: filter to user's selection (if provided). Build a lookup key for
  // (endpoint, kind, index) triples and intersect.
  let effectiveJobs = plan.jobs;
  let effectiveSkipped = plan.skipped;
  // Seleções pedidas que o planner atual não produz (endpoint depreciado/gated,
  // ex.: ONR 602, CENPROT sem gov.br). Antes a rota recusava o LOTE INTEIRO com
  // 400 quando havia qualquer unmatched — o que travava "Retentar erros"/"Só as
  // que faltaram" sempre que sobrava 1 job velho. Agora despachamos o que casa e
  // reportamos o resto como aviso. (2026-06-05)
  let unmatchedSelections: NonNullable<typeof selectedJobs> = [];
  if (selectedJobs) {
    const requestedKeys = new Set(
      selectedJobs.map((s) => `${s.endpoint}|${s.targetKind}|${s.targetIndex}`)
    );
    effectiveJobs = plan.jobs.filter((j) =>
      requestedKeys.has(`${j.endpoint}|${j.targetKind}|${j.targetIndex}`)
    );
    effectiveSkipped = plan.skipped.filter((s) =>
      requestedKeys.has(`${s.endpoint}|${s.targetKind}|${s.targetIndex}`)
    );

    // Seleções que não casaram com NENHUM job nem skip do plano atual — o
    // planner não consegue construí-las (endpoint depreciado/gated, target
    // inválido). Não recusamos o lote: removemos do despacho e reportamos.
    const matchedKeys = new Set([
      ...effectiveJobs.map((j) => `${j.endpoint}|${j.targetKind}|${j.targetIndex}`),
      ...effectiveSkipped.map((s) => `${s.endpoint}|${s.targetKind}|${s.targetIndex}`),
    ]);
    unmatchedSelections = selectedJobs.filter(
      (s) => !matchedKeys.has(`${s.endpoint}|${s.targetKind}|${s.targetIndex}`)
    );
  }

  // ---- Trava POR ALVO (substitui a antiga trava de deal inteiro) ----
  // Equivalência TJSP: pedido-certidao e pedido-civel são o mesmo alvo lógico.
  const TJSP_PEDIDO_GROUP = [
    "tribunal/tjsp/pedido-certidao",
    "tribunal/tjsp/pedido-civel",
  ];
  const supersedeEndpointsFor = (endpoint: string): string[] =>
    TJSP_PEDIDO_GROUP.includes(endpoint) ? TJSP_PEDIDO_GROUP : [endpoint];

  // Jobs candidatos a "em andamento" deste deal; isInProgressBlocking filtra
  // pending/fetching recente e awaiting_portal saudável (com protocolo), sem
  // travar zumbis nem estados terminais (erros são retentáveis).
  const activeCandidates = await prisma.certidaoJob.findMany({
    where: {
      dealId: params.dealId,
      status: { in: ["pending", "fetching", "awaiting_portal"] },
    },
    select: {
      endpoint: true,
      targetKind: true,
      targetIndex: true,
      status: true,
      retryCount: true,
      maxRetries: true,
      createdAt: true,
      resultData: true,
    },
  });
  const inProgress = activeCandidates.filter((j) => isInProgressBlocking(j));
  const isTargetBlocked = (t: {
    endpoint: string;
    targetKind: string;
    targetIndex: number;
  }) =>
    inProgress.some(
      (p) =>
        p.targetKind === t.targetKind &&
        p.targetIndex === t.targetIndex &&
        supersedeEndpointsFor(t.endpoint).includes(p.endpoint)
    );

  // Pula (sem redisparar) os alvos genuinamente em andamento; despacha o resto.
  const skippedInProgress = effectiveJobs.filter(isTargetBlocked).map((j) => ({
    endpoint: j.endpoint,
    targetKind: j.targetKind,
    targetIndex: j.targetIndex,
    label: j.label,
  }));
  effectiveJobs = effectiveJobs.filter((j) => !isTargetBlocked(j));

  if (effectiveJobs.length === 0 && effectiveSkipped.length === 0) {
    // Nada a despachar. Se foi porque tudo selecionado já está em andamento,
    // devolve 409 claro (não é erro do usuário — é só aguardar o tribunal).
    if (skippedInProgress.length > 0) {
      return NextResponse.json(
        {
          error:
            "As certidões selecionadas já estão em andamento (aguardando o tribunal). Aguarde a conclusão — não é preciso pedir de novo.",
          skippedInProgress,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error:
          unmatchedSelections.length > 0
            ? "As certidões selecionadas não estão mais disponíveis no plano atual (endpoint indisponível). Atualize e tente de novo."
            : "Nenhuma certidao disponivel para extrair",
        unmatched: unmatchedSelections,
        plan,
      },
      { status: 400 }
    );
  }

  // Check if budget would be exceeded — split por provider. Infosimples e
  // Serasa têm budgets isolados (ticket muito diferente); validamos cada um
  // contra seus próprios jobs.
  const totalCostCents = effectiveJobs.reduce((acc, j) => acc + j.costCents, 0);
  const infosimplesCostCents = effectiveJobs
    .filter((j) => (endpointInfo(j.endpoint).provider ?? "infosimples") === "infosimples")
    .reduce((acc, j) => acc + j.costCents, 0);
  const serasaCostCents = effectiveJobs
    .filter((j) => endpointInfo(j.endpoint).provider === "serasa")
    .reduce((acc, j) => acc + j.costCents, 0);
  const hasSerasaJob = serasaCostCents > 0;

  if (spend.spentCents + infosimplesCostCents > spend.budgetCents) {
    return NextResponse.json(
      {
        error: "Este lote estouraria o budget mensal Infosimples",
        spend,
        plan: { ...plan, jobs: effectiveJobs, skipped: effectiveSkipped, totalCostCents },
      },
      { status: 402 }
    );
  }
  if (hasSerasaJob && serasaSpend.spentCents + serasaCostCents > serasaSpend.budgetCents) {
    return NextResponse.json(
      {
        error: "Este lote estouraria o budget mensal Serasa",
        spend: serasaSpend,
        provider: "serasa",
        plan: { ...plan, jobs: effectiveJobs, skipped: effectiveSkipped, totalCostCents },
      },
      { status: 402 }
    );
  }

  // LGPD gate: dispatch de Serasa exige consentimento explícito por deal.
  // Sem `Deal.complianceJson.serasaConsent`, retornamos 412 e a UI abre o
  // SerasaConsentDialog (S5) antes de reenviar o POST.
  if (hasSerasaJob) {
    const compliance = (deal.complianceJson as Record<string, unknown> | null) ?? null;
    const consent = compliance?.serasaConsent as Record<string, unknown> | undefined;
    if (!consent || !consent.at) {
      return NextResponse.json(
        {
          error: "Consentimento LGPD nao registrado para consulta Serasa",
          requiresConsent: true,
          missingFor: ["serasa"],
        },
        { status: 412 }
      );
    }
  }

  // Consolidação por alvo: antes de criar as linhas novas, marcamos como
  // `replaced` as tentativas TERMINAIS anteriores do mesmo (endpoint, parte).
  // Assim a UI (que já filtra status="replaced") mostra só a tentativa viva
  // por alvo e o histórico fica acessível via toggle. NÃO tocamos em jobs
  // ainda ativos (pending/fetching/awaiting_portal) — eles podem concluir.
  const TERMINAL_REPLACEABLE = [
    "success",
    "failed",
    "failed_permanent",
    "data_missing",
    "data_invalid",
    "informativo",
    "skipped",
    "duplicate_pending",
    "replaced",
  ];
  // `supersedeEndpointsFor`/`TJSP_PEDIDO_GROUP` definidos acima (partição por
  // alvo). Reaproveitamos a mesma equivalência para o supersede: um novo lote
  // com pedido-certidao aposenta as linhas terminais antigas de pedido-civel do
  // MESMO alvo (e vice-versa), senão deals legados acumulam 2 famílias TJSP.
  // Diligenciado é deduplicado/superseded por diligentedPersonId (âncora estável),
  // não por targetIndex — assim a re-emissão não aposenta os jobs da pessoa errada
  // quando os índices deslizaram por uma remoção anterior. Demais alvos seguem por
  // targetIndex (vêm do form, estável).
  const supersedeTargets = [
    ...new Map(
      [...effectiveJobs, ...effectiveSkipped].map((j) => {
        const pid = j.targetKind === "diligenciado" ? j.diligentedPersonId ?? null : null;
        const key = pid
          ? `${j.endpoint}|diligenciado|pid:${pid}`
          : `${j.endpoint}|${j.targetKind}|${j.targetIndex}`;
        return [
          key,
          {
            endpoint: j.endpoint,
            targetKind: j.targetKind,
            targetIndex: j.targetIndex,
            diligentedPersonId: pid,
          },
        ];
      })
    ).values(),
  ];

  // Create all job rows atomically, including persisted skipped jobs so the
  // UI can render them with a "Complementar dados" action (FIX-O).
  await prisma.$transaction([
    ...supersedeTargets.map((t) =>
      prisma.certidaoJob.updateMany({
        where: {
          dealId: params.dealId,
          endpoint: { in: supersedeEndpointsFor(t.endpoint) },
          // Diligenciado com âncora → casa por pessoa; resto por índice posicional.
          ...(t.diligentedPersonId
            ? { targetKind: "diligenciado", diligentedPersonId: t.diligentedPersonId }
            : { targetKind: t.targetKind, targetIndex: t.targetIndex }),
          status: { in: TERMINAL_REPLACEABLE },
        },
        data: { status: "replaced" },
      })
    ),
    ...effectiveJobs.map((p) => {
      const info = endpointInfo(p.endpoint);
      const provider = info.provider ?? "infosimples";
      // Cada provider tem seu sanitizer (campos sensíveis diferentes). Sem
      // o split, segredos Serasa (client_secret/access_token) iam pro DB.
      const sanitized =
        provider === "serasa"
          ? sanitizeSerasaPayload(p.requestPayload)
          : sanitizePayload(p.requestPayload);
      return prisma.certidaoJob.create({
        data: {
          dealId: params.dealId,
          userId,
          batchId,
          provider,
          orgId: org.id,
          endpoint: p.endpoint,
          label: p.label,
          targetKind: p.targetKind,
          targetIndex: p.targetIndex,
          diligentedPersonId: p.diligentedPersonId ?? null,
          requestPayload: sanitized as object,
          status: info.initialStatus ?? "pending",
          costCents: null,
          // J.5 (Phase J) — cache portalUrl pra UI renderizar CTA quando
          // job falhar permanentemente, sem precisar re-consultar catálogo.
          portalUrl: info.portalUrl ?? null,
        },
      });
    }),
    ...effectiveSkipped.map((s) => {
      // J.5 — portalUrl do catálogo tem precedência sobre externalLink do
      // planner; UI usa portalUrl como fonte única de verdade.
      let portalUrl: string | null = s.externalLink ?? null;
      try {
        portalUrl = endpointInfo(s.endpoint).portalUrl ?? portalUrl;
      } catch {
        /* endpoint placeholder sem catálogo — mantém externalLink */
      }
      return prisma.certidaoJob.create({
        data: {
          dealId: params.dealId,
          userId,
          batchId,
          endpoint: s.endpoint,
          label: s.label,
          targetKind: s.targetKind,
          targetIndex: s.targetIndex,
          diligentedPersonId: s.diligentedPersonId ?? null,
          requestPayload: {
            missingField: s.missingField,
            missingFields: s.missingFields,
            ...(s.externalLink ? { externalLink: s.externalLink } : {}),
          } as object,
          status: "skipped",
          errorMessage: s.reason,
          costCents: 0,
          missingFields: s.missingFields?.length
            ? s.missingFields.map((mf) => mf.path)
            : s.missingField
            ? [s.missingField]
            : [],
          portalUrl,
        },
      });
    }),
  ]);

  // Audit dedicado pra dispatch de Serasa — separa visibilidade na trilha
  // LGPD. CERTIDAO_BATCH_DISPATCH continua sendo gravado pelos demais
  // observers (Newton/intent); aqui só marcamos Serasa explicitamente.
  if (hasSerasaJob) {
    const serasaCount = effectiveJobs.filter(
      (j) => endpointInfo(j.endpoint).provider === "serasa"
    ).length;
    void audit(
      { orgId: org.id, userId },
      {
        action: "SERASA_QUERY_DISPATCH",
        result: "SUCCESS",
        resource: params.dealId,
        resourceType: "Deal",
        metadata: {
          batchId,
          serasaJobs: serasaCount,
          serasaCostCents,
        },
      }
    );
  }

  // Mantém o lambda vivo até runBatch terminar (até maxDuration). Sem
  // waitUntil, Vercel cancela a promise assim que o NextResponse é enviado
  // e os jobs ficam orphaned em 'fetching' até o sweep (incidente 2026-05-11).
  waitUntil(
    runBatch(batchId, params.dealId).catch((err) => {
      console.error("[certidoes] runBatch failed", err);
    })
  );

  return NextResponse.json(
    {
      batchId,
      jobCount: effectiveJobs.length,
      skipped: effectiveSkipped,
      // Alvos não redisparados por já estarem em andamento (UI mostra
      // "X disparadas · Y aguardando o tribunal" em vez de erro global).
      skippedInProgress,
      // Seleções que o planner atual não constrói (endpoint depreciado/gated) —
      // ignoradas, não rejeitam o lote.
      unmatched: unmatchedSelections,
      totalCostCents,
    },
    { status: 202 }
  );
}
