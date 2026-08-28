// Executor do run de revisão pós-geração — o módulo IMPURO (prisma + Drive).
//
// Uma invocação processa o run INTEIRO (um contrato é uma unidade): claim
// atômico → skips → texto canônico → checks determinísticos → comentários →
// done. A chamada de LLM (PR 3 do Workstream B) entra entre os checks e o
// fechamento. Falha de Drive devolve o run a `queued` para o sweeper re-tentar
// — nunca propaga para a geração, que já respondeu há muito.
import { prisma } from "@/lib/db/prisma";
import { dedupeKeyFor, renderQualityChecks } from "@/lib/ai/quickChecks";
import { calcCostUsd, recordAIUsage } from "@/lib/ai/usage";
import { buildConsolidatedFormSummary } from "@/lib/forms/form-summary";
import { isContractReviewEnabled } from "./guard";
import { parseGenerationPlan } from "./plan";
import { clausePlanChecks, type ReviewFinding } from "./checks";
import { checkReviewDailyCap } from "./budget";
import {
  renderFormSummaryText,
  renderPlanSummaryText,
  runContractReviewLlm,
} from "./reviewer";
import {
  REVIEW_MAX_ATTEMPTS,
  reviewClaimWhere,
  type ReviewStatus,
} from "./review-state";

export interface AdvanceReviewResult {
  runId: string;
  claimed: boolean;
  status: ReviewStatus | "not-found";
  /** Motivo de skip/fracasso, quando houver. */
  reason?: string;
}

export async function advanceReviewRun(runId: string): Promise<AdvanceReviewResult> {
  const now = new Date();

  // Claim atômico — a disponibilidade vai no WHERE; perder a corrida = count 0.
  const claimed = await prisma.contractReviewRun.updateMany({
    where: reviewClaimWhere({ runId, now }),
    data: { status: "reviewing", startedAt: now, attempt: { increment: 1 } },
  });
  if (claimed.count === 0) {
    const existing = await prisma.contractReviewRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    return {
      runId,
      claimed: false,
      status: (existing?.status as ReviewStatus) ?? "not-found",
    };
  }

  const run = await prisma.contractReviewRun.findUniqueOrThrow({
    where: { id: runId },
    select: { id: true, orgId: true, contractId: true, attempt: true },
  });
  const contract = await prisma.contract.findUnique({
    where: { id: run.contractId },
    select: {
      id: true,
      kind: true,
      status: true,
      dataJson: true,
      htmlContent: true,
      googleDocId: true,
      generationPlanJson: true,
      deal: {
        select: {
          kind: true,
          form: { select: { dataJson: true, schemaType: true } },
        },
      },
    },
  });

  if (!contract) {
    return finalize(runId, "skipped", { reason: "contract-not-found" });
  }
  if (contract.status === "aprovado") {
    // Mesmo gate dos analisadores da geração: contrato aprovado é imutável.
    return finalize(runId, "skipped", { reason: "contract-approved" });
  }
  const enabled = await isContractReviewEnabled(run.orgId, contract.deal.kind);
  if (!enabled) {
    return finalize(runId, "skipped", { reason: "feature-disabled" });
  }

  // Texto canônico — mesmo caminho de leitura do runPassiveAnalysis
  // (lib/ai/agent.ts): Doc vivo quando existe, senão o snapshot do banco.
  let docText: string;
  if (contract.googleDocId) {
    try {
      const { getDocPlainText } = await import("@/lib/google/docs");
      docText = await getDocPlainText(contract.googleDocId);
    } catch (err) {
      console.warn(`[contract-review] Drive indisponível para o run ${runId}:`, err);
      if (run.attempt >= REVIEW_MAX_ATTEMPTS) {
        return finalize(runId, "failed", { reason: "drive-unavailable" });
      }
      // Devolve ao sweeper: claim liberado, tentativa já contada.
      await prisma.contractReviewRun.update({
        where: { id: runId },
        data: { status: "queued", startedAt: null },
      });
      return { runId, claimed: true, status: "queued", reason: "drive-retry" };
    }
  } else {
    docText = contract.htmlContent ?? "";
  }

  // ── Checks determinísticos (grátis — rodam mesmo com cap de LLM estourado) ──

  // Render linter: cinto-e-suspensório do que a geração já rodou. Mesmo
  // dedupe/autor do analyzeRenderQualityForContract → upsert idempotente com
  // os comentários criados na geração.
  const renderFindings = renderQualityChecks(docText);
  for (const f of renderFindings) {
    const dedupeKey = dedupeKeyFor("ai", `render:${f.category}`, f.selectedText);
    const text = f.suggestedFix ? `${f.message}\n\n**Sugestão:** ${f.suggestedFix}` : f.message;
    await upsertComment(contract.id, {
      dedupeKey,
      authorName: "Análise de Qualidade",
      text,
      selectedText: f.selectedText,
      severity: f.severity,
    });
  }

  // Checks do plano de geração (contrato sem plano = gerado antes da feature
  // ou importado — nada a conferir; o LLM do PR 3 ainda cobre o texto).
  const plan = parseGenerationPlan(contract.generationPlanJson);
  const planFindings: ReviewFinding[] = plan ? clausePlanChecks(plan, docText) : [];
  for (const f of planFindings) {
    const dedupeKey = dedupeKeyFor("ai", `review:${f.category}`, f.selectedText);
    const text = f.suggestedFix ? `${f.message}\n\n**Sugestão:** ${f.suggestedFix}` : f.message;
    await upsertComment(contract.id, {
      dedupeKey,
      authorName: "Revisão Pós-Geração",
      text,
      selectedText: f.selectedText,
      severity: f.severity,
    });
  }

  // ── Revisor LLM (dados×texto, coerência jurídica, estrutura) ────────────

  const llm = await runLlmStage(run, contract, plan, docText);
  if (llm.retry) {
    if (run.attempt >= REVIEW_MAX_ATTEMPTS) {
      return finalize(runId, "failed", { reason: "llm-error", detail: llm.error });
    }
    await prisma.contractReviewRun.update({
      where: { id: runId },
      data: { status: "queued", startedAt: null },
    });
    return { runId, claimed: true, status: "queued", reason: "llm-retry" };
  }

  return finalize(runId, "done", {
    deterministic: {
      hasPlan: Boolean(plan),
      renderFindings: renderFindings.length,
      planFindings: planFindings.map((f) => ({
        category: f.category,
        severity: f.severity,
      })),
    },
    llm: llm.report,
  });
}

interface LlmStageOutcome {
  /** Erro transitório de API — devolver o run ao sweeper. */
  retry?: boolean;
  error?: string;
  report: Record<string, unknown>;
}

/**
 * Estágio LLM da revisão. Skips (cap diário, teto de comentários) NÃO são
 * falha do run — os checks determinísticos acima já rodaram e são o piso da
 * revisão; o motivo fica no report.
 */
async function runLlmStage(
  run: { id: string; orgId: string; contractId: string },
  contract: {
    id: string;
    kind: string;
    dataJson: unknown;
    generationPlanJson: unknown;
    deal: {
      kind: string;
      form: { dataJson: unknown; schemaType: string | null } | null;
    };
  },
  plan: ReturnType<typeof parseGenerationPlan>,
  docText: string
): Promise<LlmStageOutcome> {
  // Teto de comentários IA não resolvidos — mesmo cap da análise passiva
  // (MAX_AI_UNRESOLVED_COMMENTS): acima disso, mais achado é ruído.
  const existingComments = await prisma.contractComment.findMany({
    where: { contractId: contract.id, authorType: "ai", resolved: false },
    select: { text: true, selectedText: true },
    take: 50,
  });
  if (existingComments.length >= 50) {
    return { report: { skipped: "comment-cap" } };
  }

  const budget = await checkReviewDailyCap(run.orgId);
  if (!budget.withinCap) {
    return {
      report: {
        skipped: "daily-cap",
        spentUsd: budget.spentUsd,
        capUsd: budget.capUsd,
      },
    };
  }

  // Família do playbook: o PLANO é a fonte (a geração sabe o que gerou);
  // contrato sem plano (legado) cai no kind do Contract (administração tem
  // kind próprio) e por fim no kind do deal.
  const family =
    plan?.family ??
    (contract.kind === "administracao"
      ? ("administracao" as const)
      : contract.deal.kind === "locacao"
        ? ("locacao" as const)
        : ("venda" as const));
  const formData = (contract.deal.form?.dataJson ?? contract.dataJson) as Record<string, unknown>;
  const sections = buildConsolidatedFormSummary(formData, {
    schemaType: contract.deal.form?.schemaType ?? null,
  });

  try {
    const result = await runContractReviewLlm({
      family,
      formSummaryText: renderFormSummaryText(sections),
      planSummaryText: renderPlanSummaryText(plan),
      docText,
      existingComments,
    });

    // Custo: uma linha de AIUsage por degrau + acumulado no run (é o que o
    // cap diário soma amanhã e o painel mostra hoje).
    let costUsd = 0;
    for (const step of result.steps) {
      costUsd += calcCostUsd(
        step.model,
        step.usage.promptTokens,
        step.usage.completionTokens,
        step.usage.cacheReadTokens,
        step.usage.cacheWriteTokens
      );
      recordAIUsage({
        orgId: run.orgId,
        contractId: contract.id,
        provider: "anthropic",
        model: step.model,
        operation: "contract_review",
        promptTokens: step.usage.promptTokens,
        completionTokens: step.usage.completionTokens,
        cacheReadTokens: step.usage.cacheReadTokens,
        cacheWriteTokens: step.usage.cacheWriteTokens,
        latencyMs: step.latencyMs,
      });
    }
    await prisma.contractReviewRun.update({
      where: { id: run.id },
      data: { aiCostUsd: costUsd },
    });

    for (const f of result.findings) {
      const dedupeKey = dedupeKeyFor("ai", `review:${f.category}`, f.selectedText);
      const parts = [f.finding];
      if (f.expected) parts.push(`**Esperado (formulário/plano):** ${f.expected}`);
      if (f.suggestedFix) parts.push(`**Sugestão:** ${f.suggestedFix}`);
      await upsertComment(contract.id, {
        dedupeKey,
        authorName: "Revisão Pós-Geração",
        text: `**${f.title}**\n\n${parts.join("\n\n")}`,
        selectedText: f.selectedText,
        severity: f.severity,
      });
    }

    return {
      report: {
        model: result.steps[result.steps.length - 1]?.model,
        findings: result.findings.map((f) => ({
          category: f.category,
          severity: f.severity,
          title: f.title,
        })),
        documentOk: result.documentOk,
        discarded: result.violations.length,
        retried: result.retried,
        costUsd,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[contract-review] LLM falhou no run ${run.id}:`, err);
    return { retry: true, error: message.slice(0, 500), report: { error: message.slice(0, 500) } };
  }
}

async function upsertComment(
  contractId: string,
  input: {
    dedupeKey: string;
    authorName: string;
    text: string;
    selectedText: string;
    severity: string;
  }
): Promise<void> {
  try {
    await prisma.contractComment.upsert({
      where: { contractId_dedupeKey: { contractId, dedupeKey: input.dedupeKey } },
      create: {
        contractId,
        userId: null,
        authorName: input.authorName,
        authorType: "ai",
        text: input.text,
        selectedText: input.selectedText.slice(0, 240),
        anchorId: input.dedupeKey,
        severity: input.severity,
        dedupeKey: input.dedupeKey,
      },
      update: { updatedAt: new Date() },
    });
  } catch (err) {
    console.error("[contract-review] upsert de comentário falhou:", err);
  }
}

async function finalize(
  runId: string,
  status: "done" | "failed" | "skipped",
  report: Record<string, unknown>
): Promise<AdvanceReviewResult> {
  await prisma.contractReviewRun.update({
    where: { id: runId },
    data: {
      status,
      report: report as any,
      ...(status === "failed" && typeof report.reason === "string"
        ? { error: report.reason }
        : {}),
    },
  });
  return {
    runId,
    claimed: true,
    status,
    ...(typeof report.reason === "string" ? { reason: report.reason } : {}),
  };
}
