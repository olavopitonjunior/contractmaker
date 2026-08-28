// Executor do run de revisão pós-geração — o módulo IMPURO (prisma + Drive).
//
// Uma invocação processa o run INTEIRO (um contrato é uma unidade): claim
// atômico → skips → texto canônico → checks determinísticos → comentários →
// done. A chamada de LLM (PR 3 do Workstream B) entra entre os checks e o
// fechamento. Falha de Drive devolve o run a `queued` para o sweeper re-tentar
// — nunca propaga para a geração, que já respondeu há muito.
import { prisma } from "@/lib/db/prisma";
import { dedupeKeyFor, renderQualityChecks } from "@/lib/ai/quickChecks";
import { isContractReviewEnabled } from "./guard";
import { parseGenerationPlan } from "./plan";
import { clausePlanChecks, type ReviewFinding } from "./checks";
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
      status: true,
      htmlContent: true,
      googleDocId: true,
      generationPlanJson: true,
      deal: { select: { kind: true } },
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

  return finalize(runId, "done", {
    deterministic: {
      hasPlan: Boolean(plan),
      renderFindings: renderFindings.length,
      planFindings: planFindings.map((f) => ({
        category: f.category,
        severity: f.severity,
      })),
    },
  });
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
