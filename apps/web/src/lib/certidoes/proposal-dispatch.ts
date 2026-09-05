/**
 * Disparo de certidões (Infosimples) a partir de uma PROPOSTA — o miolo do
 * `POST /api/deals/[dealId]/certidoes` com o sujeito trocado: jobs nascem com
 * `proposalId` (e `dealId` nulo), o convert relinka para o negócio depois.
 *
 * Deliberadamente NÃO refatora a rota de Deal (sem testes; risco de regressão
 * no caminho de venda). O que é puro é reaproveitado tal qual: planner,
 * lifecycle (trava por alvo), budget (`monthlySpendWhere` já conta jobs sem
 * deal pelo `orgId`), lock por org, catálogo. O que fica de fora na proposta:
 *  - diligenciados (`DiligentedPerson.dealId` é NOT NULL);
 *  - Serasa (a análise de crédito da proposta é a Ficha Certa — PR 6);
 *  - análise/compartilhamento/zip (superfícies do negócio).
 */

import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal } from "./planner";
import { runBatch, getMonthlySpend } from "./executor";
import { endpointInfo } from "./endpoints";
import { isInProgressBlocking } from "./lifecycle";
import { sanitizePayload } from "./infosimples";
import { checkGovBrAuth } from "./govbr-auth";
import { checkOnrAuth } from "./onr-auth";
import { monthlySpendWhere } from "./budget";
import { withOrgBudgetLock } from "@/lib/security/budget-lock";
import type { CertidoesEsteira } from "./target-paths";
import type { ExtractionPlan, TargetKind } from "./types";

export interface JobSelection {
  endpoint: string;
  targetKind: TargetKind;
  targetIndex: number;
}

export interface ProposalDispatchInput {
  proposalId: string;
  orgId: string;
  userId: string;
  userEmail: string | null;
  esteira: CertidoesEsteira;
  dataJson: Record<string, unknown>;
  batchId: string;
  selectedJobs?: JobSelection[];
}

export type ProposalDispatchResult =
  | {
      ok: true;
      status: 202;
      body: Record<string, unknown>;
      /**
       * Execução do lote — o CALLER a envolve em `waitUntil` (rota) ou a
       * aguarda (script). Disparar aqui dentro reintroduziria o incidente de
       * 2026-05-11: a Lambda é reciclada ao responder e os jobs ficam órfãos
       * em `fetching`.
       */
      run: () => Promise<void>;
    }
  | { ok: false; status: 400 | 402 | 409; body: Record<string, unknown> };

const TJSP_PEDIDO_GROUP = ["tribunal/tjsp/pedido-certidao", "tribunal/tjsp/pedido-civel"];
const supersedeEndpointsFor = (endpoint: string): string[] =>
  TJSP_PEDIDO_GROUP.includes(endpoint) ? TJSP_PEDIDO_GROUP : [endpoint];

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

const LOCK_TIMEOUT_MS = 20_000;

const keyOf = (j: { endpoint: string; targetKind: string; targetIndex: number }) =>
  `${j.endpoint}|${j.targetKind}|${j.targetIndex}`;

/** Plano da proposta: planner puro + sem Serasa. */
export async function planProposalCertidoes(input: {
  dataJson: Record<string, unknown>;
  esteira: CertidoesEsteira;
  userEmail: string | null;
  expandAll: boolean;
  extraRegions?: Array<{ uf: string; cidade?: string }>;
}): Promise<ExtractionPlan> {
  const [govbr, onr] = await Promise.all([checkGovBrAuth(), checkOnrAuth()]);
  const plan = planCertidoesForDeal(input.dataJson as never, input.userEmail ?? undefined, [], {
    expandAll: input.expandAll,
    govBrActive: govbr.active,
    onrActive: onr.active,
    esteira: input.esteira,
    ...(input.extraRegions ? { extraRegions: input.extraRegions } : {}),
  });
  return stripSerasa(plan);
}

export function stripSerasa(plan: ExtractionPlan): ExtractionPlan {
  // Catálogo é a fonte; o prefixo é a rede de segurança (endpoint fora do
  // catálogo não pode passar como Infosimples por engano).
  const isSerasa = (endpoint: string) => {
    if (endpoint.startsWith("serasa/")) return true;
    try {
      return endpointInfo(endpoint).provider === "serasa";
    } catch {
      return false;
    }
  };
  const jobs = plan.jobs.filter((j) => !isSerasa(j.endpoint));
  const skipped = plan.skipped.filter((s) => !isSerasa(s.endpoint));
  return { ...plan, jobs, skipped, totalCostCents: jobs.reduce((a, j) => a + j.costCents, 0) };
}

export async function dispatchProposalCertidoes(input: ProposalDispatchInput): Promise<ProposalDispatchResult> {
  const { proposalId, orgId, userId, batchId, selectedJobs } = input;

  const spend = await getMonthlySpend(orgId);
  if (spend.exceeded) {
    return { ok: false, status: 402, body: { error: "Budget mensal de certidoes Infosimples atingido", spend } };
  }

  const plan = await planProposalCertidoes({
    dataJson: input.dataJson,
    esteira: input.esteira,
    userEmail: input.userEmail,
    expandAll: !!selectedJobs,
  });

  let effectiveJobs = plan.jobs;
  let effectiveSkipped = plan.skipped;
  let unmatchedSelections: JobSelection[] = [];
  if (selectedJobs) {
    const requested = new Set(selectedJobs.map(keyOf));
    effectiveJobs = plan.jobs.filter((j) => requested.has(keyOf(j)));
    effectiveSkipped = plan.skipped.filter((s) => requested.has(keyOf(s)));
    const matched = new Set([...effectiveJobs.map(keyOf), ...effectiveSkipped.map(keyOf)]);
    unmatchedSelections = selectedJobs.filter((s) => !matched.has(keyOf(s)));
  }

  // Trava POR ALVO: o que está genuinamente em andamento não é redisparado.
  const activeCandidates = await prisma.certidaoJob.findMany({
    where: { proposalId, status: { in: ["pending", "fetching", "awaiting_portal"] } },
    select: {
      endpoint: true,
      targetKind: true,
      targetIndex: true,
      diligentedPersonId: true,
      status: true,
      retryCount: true,
      maxRetries: true,
      createdAt: true,
      resultData: true,
    },
  });
  const inProgress = activeCandidates.filter((j) => isInProgressBlocking(j));
  const isBlocked = (t: { endpoint: string; targetKind: string; targetIndex: number }) =>
    inProgress.some(
      (p) =>
        supersedeEndpointsFor(t.endpoint).includes(p.endpoint) &&
        p.targetKind === t.targetKind &&
        p.targetIndex === t.targetIndex
    );
  const skippedInProgress = effectiveJobs.filter(isBlocked).map((j) => ({
    endpoint: j.endpoint,
    targetKind: j.targetKind,
    targetIndex: j.targetIndex,
    label: j.label,
  }));
  effectiveJobs = effectiveJobs.filter((j) => !isBlocked(j));

  if (effectiveJobs.length === 0 && effectiveSkipped.length === 0) {
    if (skippedInProgress.length > 0) {
      return {
        ok: false,
        status: 409,
        body: {
          error:
            "As certidões selecionadas já estão em andamento (aguardando o tribunal). Aguarde a conclusão — não é preciso pedir de novo.",
          skippedInProgress,
        },
      };
    }
    return {
      ok: false,
      status: 400,
      body: {
        error:
          unmatchedSelections.length > 0
            ? "As certidões selecionadas não estão mais disponíveis no plano atual (endpoint indisponível). Atualize e tente de novo."
            : "Nenhuma certidao disponivel para extrair",
        unmatched: unmatchedSelections,
        plan,
      },
    };
  }

  const totalCostCents = effectiveJobs.reduce((acc, j) => acc + j.costCents, 0);
  if (spend.spentCents + totalCostCents > spend.budgetCents) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "Este lote estouraria o budget mensal Infosimples",
        spend,
        plan: { ...plan, jobs: effectiveJobs, skipped: effectiveSkipped, totalCostCents },
      },
    };
  }

  const supersedeTargets = [
    ...new Map(
      [...effectiveJobs, ...effectiveSkipped].map((j) => [
        keyOf(j),
        { endpoint: j.endpoint, targetKind: j.targetKind, targetIndex: j.targetIndex },
      ])
    ).values(),
  ];

  const budgetHit = await withOrgBudgetLock(
    "infosimples",
    orgId,
    async (tx) => {
      if (totalCostCents > 0) {
        const agg = await tx.certidaoJob.aggregate({
          where: monthlySpendWhere(orgId, "infosimples"),
          _sum: { costCents: true },
        });
        const spentNow = agg._sum.costCents ?? 0;
        if (spentNow + totalCostCents > spend.budgetCents) {
          return { spentCents: spentNow, budgetCents: spend.budgetCents, exceeded: true };
        }
      }
      for (const t of supersedeTargets) {
        await tx.certidaoJob.updateMany({
          where: {
            proposalId,
            endpoint: { in: supersedeEndpointsFor(t.endpoint) },
            targetKind: t.targetKind,
            targetIndex: t.targetIndex,
            status: { in: TERMINAL_REPLACEABLE },
          },
          data: { status: "replaced" },
        });
      }
      for (const p of effectiveJobs) {
        const info = endpointInfo(p.endpoint);
        await tx.certidaoJob.create({
          data: {
            proposalId,
            userId,
            batchId,
            provider: info.provider ?? "infosimples",
            orgId,
            endpoint: p.endpoint,
            label: p.label,
            targetKind: p.targetKind,
            targetIndex: p.targetIndex,
            requestPayload: sanitizePayload(p.requestPayload) as object,
            status: info.initialStatus ?? "pending",
            costCents: null,
            portalUrl: info.portalUrl ?? null,
          },
        });
      }
      for (const s of effectiveSkipped) {
        let portalUrl: string | null = s.externalLink ?? null;
        try {
          portalUrl = endpointInfo(s.endpoint).portalUrl ?? portalUrl;
        } catch {
          /* endpoint placeholder sem catálogo */
        }
        await tx.certidaoJob.create({
          data: {
            proposalId,
            userId,
            batchId,
            orgId,
            endpoint: s.endpoint,
            label: s.label,
            targetKind: s.targetKind,
            targetIndex: s.targetIndex,
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
      }
      return null;
    },
    { timeoutMs: LOCK_TIMEOUT_MS }
  );
  if (budgetHit) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "Este lote estouraria o budget mensal Infosimples",
        spend: budgetHit,
        plan: { ...plan, jobs: effectiveJobs, skipped: effectiveSkipped, totalCostCents },
      },
    };
  }

  return {
    ok: true,
    status: 202,
    // `runBatch(batchId, null)`: escopo só pelo batch — o mesmo caminho do
    // LeaseClient. Devolvido como função para o caller decidir como esperar.
    run: () =>
      runBatch(batchId, null).catch((err) => {
        console.error("[certidoes] runBatch (proposta) failed", err);
      }),
    body: {
      batchId,
      jobCount: effectiveJobs.length,
      skipped: effectiveSkipped,
      skippedInProgress,
      unmatched: unmatchedSelections,
      totalCostCents,
    },
  };
}
