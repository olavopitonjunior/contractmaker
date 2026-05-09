import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

const Body = z.object({
  reason: z.string().min(3).max(500),
  category: z
    .enum(["desistencia", "imovel_vendido", "financiamento_negado", "outro"])
    .optional(),
});

const TERMINAL_STAGES = ["Comissão paga", "Negócio perdido"];

/**
 * POST /api/pipeline/deals/:dealId/mark-lost
 *
 * Move deal pra "Negócio perdido" — terminal alternativo a partir de qualquer
 * stage não-terminal. Captura motivo (categoria + texto livre) pra futuro
 * relatório de causas perdidas.
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message },
      { status: 400 }
    );
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

  if (TERMINAL_STAGES.includes(deal.stage.name)) {
    return NextResponse.json(
      {
        error: `Negócio já está em estágio terminal ("${deal.stage.name}") — reabra antes de marcar como perdido`,
      },
      { status: 400 }
    );
  }

  const targetStage = deal.pipeline.stages.find(
    (s) => s.name === "Negócio perdido"
  );
  if (!targetStage) {
    return NextResponse.json(
      { error: 'Estágio "Negócio perdido" não encontrado no pipeline' },
      { status: 400 }
    );
  }

  const formattedReason = parsed.data.category
    ? `[${parsed.data.category}] ${parsed.data.reason}`
    : parsed.data.reason;

  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      stageId: targetStage.id,
      lostAt: new Date(),
      lostReason: formattedReason,
    },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "DEAL_STAGE_CHANGE",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      kind: "lost",
      reason: parsed.data.reason,
      category: parsed.data.category ?? null,
      previousStageId: deal.stage.id,
      previousStageName: deal.stage.name,
      toStage: targetStage.id,
    },
  });

  return NextResponse.json({
    status: "perdido",
    dealId: deal.id,
    stageId: targetStage.id,
    stageName: targetStage.name,
  });
}
