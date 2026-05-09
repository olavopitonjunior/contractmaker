import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

/**
 * POST /api/pipeline/deals/:dealId/mark-commission-paid
 *
 * Move deal pra "Comissão paga" e popula `commissionPaidAt`. Usado quando o
 * usuário recebeu a comissão (manual — não há trigger Asaas confiável pra
 * "dinheiro saiu da subconta e caiu na conta operacional").
 *
 * Aceita stage atual "Cobrança emitida" (caminho normal) ou "Contrato
 * assinado" (caso a charge tenha sido gerada fora do sistema).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
    },
  });

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ALLOWED_FROM = ["Cobrança emitida", "Contrato assinado"];
  if (!ALLOWED_FROM.includes(deal.stage.name)) {
    return NextResponse.json(
      {
        error: `Negócio precisa estar em "Cobrança emitida" (está em "${deal.stage.name}")`,
      },
      { status: 400 }
    );
  }

  const targetStage = deal.pipeline.stages.find(
    (s) => s.name === "Comissão paga"
  );
  if (!targetStage) {
    return NextResponse.json(
      { error: 'Estágio "Comissão paga" não encontrado no pipeline' },
      { status: 400 }
    );
  }

  await prisma.deal.update({
    where: { id: deal.id },
    data: { stageId: targetStage.id, commissionPaidAt: new Date() },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "DEAL_STAGE_CHANGE",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      kind: "commission_paid",
      fromStage: deal.stage.id,
      toStage: targetStage.id,
    },
  });

  return NextResponse.json({
    status: "comissao_paga",
    dealId: deal.id,
    stageId: targetStage.id,
    stageName: targetStage.name,
  });
}
