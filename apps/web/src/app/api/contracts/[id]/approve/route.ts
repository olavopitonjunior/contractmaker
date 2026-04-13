import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { validateContractData } from "@/lib/ai/validators";

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
    data: { status: "aprovado" },
  });

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

  return NextResponse.json({ status: "aprovado" });
}
