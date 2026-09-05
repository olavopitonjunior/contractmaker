import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { TERMINAL_STATUSES } from "@/lib/proposals/status-sets";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import { readCreditConsent } from "@/lib/credit/consent";
import { derivePretendentes, tipoImovelForSchema, type Pretendente } from "@/lib/credit/pretendentes";
import { applyProposalExtractions } from "@/lib/proposals/apply-extractions";
import { getOrgFichaCertaCreds } from "@/lib/fichacerta/account";
import { getCredits } from "@/lib/fichacerta/client";
import { buildApplicantPayload, buildSolicitationPayload } from "@/lib/fichacerta/payload";
import { isInProgressBlocking } from "@/lib/certidoes/lifecycle";
import { monthlyBudgetCents, monthlySpendWhere } from "@/lib/certidoes/budget";
import { submitCreditRequest, type CreditRequestJson } from "@/lib/credit/fichacerta-runner";
import { withOrgBudgetLock } from "@/lib/security/budget-lock";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROVIDER = "fichacerta";
const ACTIVE = ["pending", "fetching", "submitting", "awaiting_portal"];
const WRITE_BLOCKED = new Set([...TERMINAL_STATUSES].filter((s) => s !== "completa"));

/** Rótulo do job SEM nome de pessoa — vai cru para as pendências do Max. */
function jobLabel(p: Pretendente): string {
  return `Análise de crédito (Ficha Certa) — ${p.label}`;
}

function jobView(j: {
  id: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  status: string;
  errorMessage: string | null;
  expectedReadyAt: Date | null;
  resultData: unknown;
  createdAt: Date;
}) {
  const r = (j.resultData && typeof j.resultData === "object" ? j.resultData : {}) as Record<string, unknown>;
  const raw = (r.raw && typeof r.raw === "object" ? r.raw : {}) as Record<string, unknown>;
  return {
    id: j.id,
    label: j.label,
    targetKind: j.targetKind,
    targetIndex: j.targetIndex,
    status: j.status,
    situacao: typeof r.situacao === "string" ? r.situacao : null,
    detalhes: typeof r.detalhes === "string" ? r.detalhes : null,
    scoreFc: typeof raw.scoreFc === "number" ? raw.scoreFc : null,
    parecer: typeof raw.parecer === "string" ? raw.parecer : null,
    recomendacoes: Array.isArray(raw.recomendacoes) ? raw.recomendacoes : [],
    errorMessage: j.errorMessage,
    expectedReadyAt: j.expectedReadyAt,
    createdAt: j.createdAt,
  };
}

async function listRequests(proposalId: string) {
  const requests = await prisma.creditAnalysisRequest.findMany({
    where: { proposalId, provider: PROVIDER },
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { createdAt: "asc" } } },
  });
  return requests.map((r) => ({
    id: r.id,
    status: r.status,
    externalId: r.externalId,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    completedAt: r.completedAt,
    lastSyncedAt: r.lastSyncedAt,
    errorMessage: r.errorMessage,
    costCents: r.costCents,
    reportAttachmentId: r.reportProposalAttachmentId,
    parecer: r.resultJson ?? null,
    jobs: r.jobs.map(jobView),
  }));
}

async function gate(req: NextRequest, id: string, write: boolean) {
  const r = await loadScopedProposal(req, id);
  if ("fail" in r) return { fail: r.fail };
  const { auth, eff, proposal } = r;
  if (write && !can(eff, PERMISSION.PROPOSAL_SEND)) {
    return { fail: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return { fail: feat };
  const view = await getOrgModules(auth.org.id);
  if (proposal.kind !== "locacao" || !isFeatureEnabled(view, FEATURE.LOCACAO_CREDITO)) {
    return { fail: NextResponse.json({ error: "MODULE_DISABLED" }, { status: 403 }) };
  }
  if (write && WRITE_BLOCKED.has(proposal.status)) {
    return { fail: NextResponse.json({ error: "Proposta encerrada não recebe análise de crédito." }, { status: 409 }) };
  }
  return { auth, proposal };
}

/** GET — estado da análise (requests + jobs) para o card. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await gate(req, params.id, false);
  if ("fail" in g) return g.fail;
  const creds = await getOrgFichaCertaCreds(g.auth.org.id);
  return NextResponse.json({
    configured: !!creds,
    consent: readCreditConsent(g.proposal.complianceJson),
    costCents: creds?.costCents ?? null,
    requests: await listRequests(g.proposal.id),
  });
}

const bodySchema = z.object({ batchId: z.string().min(8).optional() });

/**
 * POST /api/proposals/:id/credit/analysis — dispara a análise de crédito
 * (Ficha Certa) para TODOS os pretendentes prontos da proposta.
 *
 * Gates, na ordem: feature/kind, PROPOSAL_SEND, proposta viva, conta
 * conectada (503), consentimento LGPD (412), pretendentes completos (422),
 * alvo já em andamento (409), teto mensal e créditos pré-pagos (402).
 * Cria `CreditAnalysisRequest` + 1 `CertidaoJob` por pretendente e devolve
 * 202; o envio à Ficha Certa acontece em `submitCreditRequest` sob waitUntil.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await gate(req, params.id, true);
  if ("fail" in g) return g.fail;
  const { auth, proposal } = g;
  const orgId = auth.org.id;
  const userId = auth.actor.effectiveUserId;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  const batchId = parsed.data.batchId ?? crypto.randomUUID();

  const creds = await getOrgFichaCertaCreds(orgId);
  if (!creds) {
    return NextResponse.json(
      { error: "Conta Ficha Certa não conectada. Conecte em Configurações › Integrações.", notConfigured: true },
      { status: 503 }
    );
  }
  if (!readCreditConsent(proposal.complianceJson)) {
    return NextResponse.json(
      { error: "Consentimento LGPD não registrado para a análise de crédito", requiresConsent: true },
      { status: 412 }
    );
  }

  const attachments = await prisma.proposalAttachment.findMany({ where: { proposalId: proposal.id } });
  const dataJson = (proposal.dataJson && typeof proposal.dataJson === "object" ? proposal.dataJson : {}) as Record<string, unknown>;
  const merged = applyProposalExtractions(dataJson, attachments, proposal.kind).merged;
  const pretendentes = derivePretendentes(merged);
  if (pretendentes.length === 0) {
    return NextResponse.json({ error: "Nenhum pretendente identificado na proposta" }, { status: 422 });
  }
  const incompletos = pretendentes.filter((p) => p.missing.length > 0);
  if (incompletos.length > 0) {
    return NextResponse.json(
      {
        error: "Há pretendentes com dados faltando — complete em Pretendentes & renda",
        missing: incompletos.map((p) => ({ kind: p.kind, index: p.index, label: p.label, missing: p.missing })),
      },
      { status: 422 }
    );
  }

  // Créditos pré-pagos da conta (chamada de rede — fora do lock).
  let credits: number;
  try {
    credits = await getCredits(creds);
  } catch (err) {
    return NextResponse.json(
      { error: `Ficha Certa indisponível: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const tipoImovel = tipoImovelForSchema(proposal.schemaType);
  const budget = monthlyBudgetCents(PROVIDER);

  // Sob o advisory lock da org (o mesmo do Infosimples/ClickSign): a trava por
  // alvo, o teto mensal e a criação do request+jobs são leitura→escrita sem
  // serialização; dois cliques quase simultâneos passavam os dois pela trava
  // vazia e criavam DUAS solicitações reais — cobrança dobrada.
  type Outcome =
    | { kind: "in_progress" }
    | { kind: "budget"; spent: number; estimate: number }
    | { kind: "credits"; needed: number }
    | { kind: "ok"; requestId: string; jobCount: number; estimate: number };
  const outcome = await withOrgBudgetLock<Outcome>(
    PROVIDER,
    orgId,
    async (tx) => {
      const active = await tx.certidaoJob.findMany({
        where: { proposalId: proposal.id, provider: PROVIDER, status: { in: ACTIVE } },
        select: { targetKind: true, targetIndex: true, status: true, createdAt: true, resultData: true, retryCount: true, maxRetries: true },
      });
      const blocked = active.filter((j) => isInProgressBlocking(j));
      const toDispatch = pretendentes.filter(
        (p) => !blocked.some((b) => b.targetKind === p.kind && b.targetIndex === p.index)
      );
      if (toDispatch.length === 0) return { kind: "in_progress" };

      const estimate = toDispatch.length * creds.costCents;
      const agg = await tx.certidaoJob.aggregate({ _sum: { costCents: true }, where: monthlySpendWhere(orgId, PROVIDER) });
      const spent = agg._sum.costCents ?? 0;
      if (spent + estimate > budget) return { kind: "budget", spent, estimate };
      if (credits < toDispatch.length) return { kind: "credits", needed: toDispatch.length };

      const solicitation = buildSolicitationPayload(
        { dataJson: merged, schemaType: proposal.schemaType, code: proposal.code ?? proposal.id, produtos: creds.products },
        toDispatch[0]
      );
      const requestJson: CreditRequestJson = { locacao: solicitation.locacao, produtos: creds.products, produtosPj: [4] };
      const created = await tx.creditAnalysisRequest.create({
        data: {
          orgId,
          userId,
          proposalId: proposal.id,
          provider: PROVIDER,
          purpose: "locacao",
          status: "pending",
          batchId,
          requestJson: requestJson as unknown as Prisma.InputJsonValue,
        },
      });
      for (const p of toDispatch) {
        await tx.certidaoJob.create({
          data: {
            proposalId: proposal.id,
            orgId,
            userId,
            batchId,
            provider: PROVIDER,
            creditRequestId: created.id,
            endpoint: p.pessoa === "juridica" ? "fichacerta/laudo-pj" : "fichacerta/laudo-pf",
            label: jobLabel(p),
            targetKind: p.kind,
            targetIndex: p.index,
            requestPayload: buildApplicantPayload(p, tipoImovel) as unknown as Prisma.InputJsonValue,
            status: "pending",
            costCents: null,
          },
        });
      }
      return { kind: "ok", requestId: created.id, jobCount: toDispatch.length, estimate };
    },
    { timeoutMs: 20_000 }
  );

  if (outcome.kind === "in_progress") {
    return NextResponse.json(
      { error: "A análise de crédito destes pretendentes já está em andamento. Aguarde o laudo.", inProgress: true },
      { status: 409 }
    );
  }
  if (outcome.kind === "budget") {
    waitUntil(
      audit(extractAuditContextFromRequest(req, orgId, userId), {
        action: "CREDIT_BUDGET_EXCEEDED",
        result: "DENIED",
        resource: proposal.id,
        resourceType: "Proposal",
        metadata: { spent: outcome.spent, estimate: outcome.estimate, budget, provider: PROVIDER },
      }).catch(() => {})
    );
    return NextResponse.json(
      { error: "Teto mensal da análise de crédito atingido", spend: { spentCents: outcome.spent, budgetCents: budget } },
      { status: 402 }
    );
  }
  if (outcome.kind === "credits") {
    return NextResponse.json(
      { error: `Créditos insuficientes na Ficha Certa (${credits} disponíveis para ${outcome.needed} pretendentes)`, credits },
      { status: 402 }
    );
  }
  const request = { id: outcome.requestId };
  const estimate = outcome.estimate;
  const toDispatch = { length: outcome.jobCount };

  waitUntil(
    audit(extractAuditContextFromRequest(req, orgId, userId), {
      action: "CREDIT_ANALYSIS_DISPATCH",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: { requestId: request.id, batchId, jobCount: toDispatch.length, estimateCents: estimate, provider: PROVIDER },
    }).catch(() => {})
  );
  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: "credit_analysis_dispatched",
        source: "system",
        payload: { requestId: request.id, batchId, jobCount: toDispatch.length },
      },
    })
    .catch(() => {});
  waitUntil(
    submitCreditRequest(request.id).catch((err) => {
      console.error("[fichacerta] submitCreditRequest failed", err);
    })
  );

  return NextResponse.json(
    { requestId: request.id, batchId, jobCount: toDispatch.length, totalCostCents: estimate },
    { status: 202 }
  );
}
