import { prisma } from "@/lib/db/prisma";
import { validateContractData } from "@/lib/ai/validators";
import { createContractMemory } from "@/lib/ai/memory";

/**
 * Lógica pura de aprovação de contrato — extraída do route handler para
 * permitir reuso em (a) chamada session direta, (b) executor de ActionIntent
 * quando aprovação humana confirma uma intent criada via Bearer.
 *
 * Retorna `{ status, body }` no formato que o route handler usa diretamente.
 */

export interface ApproveContractInput {
  contractId: string;
  /** True para forçar aprovação ignorando warnings (não bypass de hard blockers). */
  force: boolean;
  /** userId que está aprovando — pra log + cross-user guard quando bearer. */
  actorUserId: string;
  /** Pra ContractChangeLog: humano (email) ou newton ("via Newton em nome de X"). */
  actorLabel: string;
  /** Se true, cross-user guard exige que actorUserId == contract.userId. */
  enforceOwnerGuard: boolean;
}

export interface ApproveContractRequiresReview {
  status: 200;
  body: {
    requiresReview: true;
    canForce: boolean;
    issues: ReturnType<typeof validateContractData>;
    errorCount: number;
    warningCount: number;
    pendingSuggestions: number;
    unresolvedComments: number;
    errorComments: number;
  };
}

export interface ApproveContractDone {
  status: 200;
  body: { status: "aprovado" };
}

export interface ApproveContractError {
  status: 400 | 403 | 404;
  body: { error: string; reason?: string };
}

export type ApproveContractResult =
  | ApproveContractRequiresReview
  | ApproveContractDone
  | ApproveContractError;

export async function runContractApproval(
  input: ApproveContractInput
): Promise<ApproveContractResult> {
  const contract = await prisma.contract.findUnique({
    where: { id: input.contractId },
  });
  if (!contract) {
    return { status: 404, body: { error: "Contrato não encontrado" } };
  }
  if (input.enforceOwnerGuard && contract.userId !== input.actorUserId) {
    return {
      status: 403,
      body: { error: "Forbidden", reason: "not the contract owner" },
    };
  }
  if (contract.status === "aprovado") {
    return { status: 400, body: { error: "Contrato já está aprovado" } };
  }

  const issues = validateContractData(
    contract.dataJson as Record<string, unknown>
  );
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const [pendingSuggestions, errorComments, unresolvedComments] = await Promise.all([
    prisma.contractSuggestion.count({
      where: { contractId: input.contractId, status: "pending" },
    }),
    prisma.contractComment.count({
      where: { contractId: input.contractId, resolved: false, severity: "error" },
    }),
    prisma.contractComment.count({
      where: { contractId: input.contractId, resolved: false },
    }),
  ]);

  const hasHardBlockers = errors.length > 0 || errorComments > 0;
  const hasSoftIssues =
    warnings.length > 0 || pendingSuggestions > 0 || unresolvedComments > 0;

  if (!input.force && (hasHardBlockers || hasSoftIssues)) {
    return {
      status: 200,
      body: {
        requiresReview: true,
        canForce: !hasHardBlockers,
        issues,
        errorCount: errors.length,
        warningCount: warnings.length,
        pendingSuggestions,
        unresolvedComments,
        errorComments,
      },
    };
  }

  // Aprovar — em GDocs mode, antes de gravar o status, capturamos o HTML
  // atual do Drive como snapshot final. Sem isso, `Contract.htmlContent` fica
  // permanentemente travado na versão inicial (renderizada na geração) e o
  // `createContractMemory` indexa embedding sobre conteúdo desatualizado,
  // distorcendo `find_similar_contracts`. Falha do export NÃO bloqueia
  // aprovação — caímos pro htmlContent existente.
  let snapshotHtml: string | undefined;
  if (contract.googleDocId) {
    try {
      const { exportDocAsHtml } = await import("@/lib/google/docs");
      snapshotHtml = await exportDocAsHtml(contract.googleDocId);
    } catch (err) {
      console.error(
        "[approve-action] Falha ao exportar HTML do GDoc (segue com htmlContent atual):",
        err
      );
    }
  }

  await prisma.contract.update({
    where: { id: input.contractId },
    data: {
      status: "aprovado",
      ...(snapshotHtml ? { htmlContent: snapshotHtml } : {}),
      ...(contract.googleDocId
        ? { googleDocStatus: "approved_readonly" }
        : {}),
    },
  });

  // Watermark removal + readonly (Google Docs) — falhas não desfazem aprovação
  if (contract.googleDocId) {
    try {
      const { batchUpdateDoc, getDocStructure, makeDocReadOnly } = await import(
        "@/lib/google/docs"
      );
      const doc = await getDocStructure(contract.googleDocId);
      const blocks = doc.body?.content || [];
      const watermarkBlock = blocks.find((b) => {
        const para = b.paragraph;
        if (!para) return false;
        const text = (para.elements || [])
          .map((el) => el.textRun?.content || "")
          .join("");
        return text.includes("[[WATERMARK_MINUTA]]");
      });
      if (
        watermarkBlock &&
        watermarkBlock.startIndex !== undefined &&
        watermarkBlock.endIndex !== undefined
      ) {
        await batchUpdateDoc(contract.googleDocId, [
          {
            deleteContentRange: {
              range: {
                startIndex: watermarkBlock.startIndex,
                endIndex: watermarkBlock.endIndex,
              },
            },
          },
        ]);
      }
      await makeDocReadOnly(contract.googleDocId);
    } catch (err) {
      console.error(
        "[approve-action] Falha ao remover watermark / tornar readonly:",
        err
      );
    }
  }

  await prisma.contractChangeLog.create({
    data: {
      contractId: input.contractId,
      userId: input.actorUserId,
      action: "status_change",
      summary: `Contrato aprovado por ${input.actorLabel}`,
      details: {
        previousStatus: contract.status,
        newStatus: "aprovado",
        forced: input.force,
        warningsIgnored: warnings.length,
        pendingSuggestionsIgnored: pendingSuggestions,
        unresolvedCommentsIgnored: unresolvedComments,
      },
      source: "user",
    },
  });

  // Auto-move deal pra "Assinatura"
  if (contract.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: contract.dealId },
      include: {
        pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
      },
    });
    if (deal?.pipeline) {
      const assinaturaStage = deal.pipeline.stages.find(
        (s) => s.name === "Assinatura"
      );
      if (assinaturaStage) {
        await prisma.deal.update({
          where: { id: deal.id },
          data: { stageId: assinaturaStage.id },
        });
      }
    }
  }

  // ContractMemory hook fire-and-forget
  void createContractMemory(input.contractId)
    .then((result) => {
      if (!result.ok) {
        console.error(
          "[approve-action] createContractMemory failed:",
          result.error
        );
      }
    })
    .catch((err) => {
      console.error("[approve-action] memory hook crashed:", err);
    });

  return { status: 200, body: { status: "aprovado" } };
}
