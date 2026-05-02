import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { validateContractData } from "@/lib/ai/validators";
import { createContractMemory } from "@/lib/ai/memory";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
  });

  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  if (contract.status === "aprovado") {
    return NextResponse.json({ error: "Contrato já está aprovado" }, { status: 400 });
  }

  // Run validation
  const issues = validateContractData(contract.dataJson as Record<string, unknown>);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  // Count pending suggestions and unresolved error-level comments
  const [pendingSuggestions, errorComments, unresolvedComments] = await Promise.all([
    prisma.contractSuggestion.count({
      where: { contractId: params.id, status: "pending" },
    }),
    prisma.contractComment.count({
      where: { contractId: params.id, resolved: false, severity: "error" },
    }),
    prisma.contractComment.count({
      where: { contractId: params.id, resolved: false },
    }),
  ]);

  const hasHardBlockers = errors.length > 0 || errorComments > 0;
  const hasSoftIssues =
    warnings.length > 0 || pendingSuggestions > 0 || unresolvedComments > 0;

  // If there are issues and the user has not confirmed, ask for review
  if (!force && (hasHardBlockers || hasSoftIssues)) {
    return NextResponse.json({
      requiresReview: true,
      canForce: !hasHardBlockers,
      issues,
      errorCount: errors.length,
      warningCount: warnings.length,
      pendingSuggestions,
      unresolvedComments,
      errorComments,
    });
  }

  // Approve
  await prisma.contract.update({
    where: { id: params.id },
    data: {
      status: "aprovado",
      ...(contract.googleDocId ? { googleDocStatus: "approved_readonly" } : {}),
    },
  });

  // Quando o contrato é Google Doc:
  //  1. Deleta o parágrafo do watermark inteiro (não só o texto — replaceAllText
  //     deixava o parágrafo vazio ocupando espaço gigante por causa do fontSize
  //     96pt do template)
  //  2. Revoga permissões de escrita no Drive (doc fica readonly)
  // Espelha a regra "contratos aprovados são imutáveis". Falhas aqui não
  // desfazem aprovação — só logam.
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
      console.error("[approve] Falha ao remover watermark / tornar readonly:", err);
    }
  }

  // Log approval
  await prisma.contractChangeLog.create({
    data: {
      contractId: params.id,
      userId: session.user.id,
      action: "status_change",
      summary: `Contrato aprovado por ${session.user.name || session.user.email}`,
      details: {
        previousStatus: contract.status,
        newStatus: "aprovado",
        forced: force,
        warningsIgnored: warnings.length,
        pendingSuggestionsIgnored: pendingSuggestions,
        unresolvedCommentsIgnored: unresolvedComments,
      },
      source: "user",
    },
  });

  // Auto-move deal to "Assinatura" stage
  if (contract.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: contract.dealId },
      include: { pipeline: { include: { stages: { orderBy: { position: "asc" } } } } },
    });
    if (deal?.pipeline) {
      const assinaturaStage = deal.pipeline.stages.find((s) => s.name === "Assinatura");
      if (assinaturaStage) {
        await prisma.deal.update({
          where: { id: deal.id },
          data: { stageId: assinaturaStage.id },
        });
      }
    }
  }

  // Fire-and-forget: snapshot this approved contract into ContractMemory for
  // the learning loop (find_similar_contracts, propose_*). We don't await it
  // so the approval response stays fast; errors are logged but don't rollback.
  void createContractMemory(params.id)
    .then((result) => {
      if (!result.ok) {
        console.error("[approve] createContractMemory failed:", result.error);
      }
    })
    .catch((err) => {
      console.error("[approve] memory hook crashed:", err);
    });

  return NextResponse.json({ status: "aprovado" });
}
