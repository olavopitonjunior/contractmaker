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

  if (deal.stage.name !== "Assinatura") {
    return NextResponse.json(
      { error: "Deal precisa estar no estagio Assinatura" },
      { status: 400 }
    );
  }

  const concluidoStage = deal.pipeline.stages.find(
    (s) => s.name === "Concluido"
  );

  if (!concluidoStage) {
    return NextResponse.json(
      { error: "Estagio Concluido nao encontrado" },
      { status: 400 }
    );
  }

  await prisma.deal.update({
    where: { id: deal.id },
    data: { stageId: concluidoStage.id },
  });

  return NextResponse.json({ status: "concluido", stageId: concluidoStage.id });
}
