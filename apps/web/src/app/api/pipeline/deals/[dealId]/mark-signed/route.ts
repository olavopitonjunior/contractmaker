import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function POST(
  _req: NextRequest,
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

  // Aceita stages do meio do funil pós-assinatura — usuário pode chamar este
  // endpoint legado pra pular direto pra "Comissão paga" (compat).
  const ALLOWED_FROM = [
    "Enviado para assinatura",
    "Contrato assinado",
    "Cobrança emitida",
  ];
  if (!ALLOWED_FROM.includes(deal.stage.name)) {
    return NextResponse.json(
      { error: `Negócio precisa estar entre "Enviado para assinatura" e "Cobrança emitida" (está em "${deal.stage.name}")` },
      { status: 400 }
    );
  }

  const targetStage = deal.pipeline.stages.find(
    (s) => s.name === "Comissão paga"
  );

  if (!targetStage) {
    return NextResponse.json(
      { error: 'Estágio "Comissão paga" não encontrado' },
      { status: 400 }
    );
  }

  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      stageId: targetStage.id,
      stageEnteredAt: new Date(),
      commissionPaidAt: new Date(),
    },
  });

  return NextResponse.json({ status: "comissao_paga", stageId: targetStage.id });
}
