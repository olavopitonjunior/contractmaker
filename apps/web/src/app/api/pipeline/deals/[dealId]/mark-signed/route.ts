import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import {
  notifyDealEvent,
  stageChangeDedupeKey,
} from "@/lib/notifications/deal-events";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  // `requireAuth` (e não `auth()` cru): sob impersonation de tenant,
  // `ctx.userId` é o DONO do tenant — é ele que tem membership/RBAC na org
  // impersonada. Com o id cru do super_admin o RBAC negava tudo (404/403).
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

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

  // Cross-org + escopo do gerente + DEAL_EDIT. Esta rota legada não checava
  // org própria — o guard fecha as duas coisas.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

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

  await moveDealStage({
    dealId: deal.id,
    toStageId: targetStage.id,
    reason: "mark_signed",
    actorUserId: ctx.userId,
    orgId: ctx.orgId,
    dealData: { commissionPaidAt: new Date() },
  });

  // Notificação do processo (endpoint manual legado — sem evento semântico
  // equivalente cobrindo este salto).
  waitUntil(
    notifyDealEvent({
      dealId: deal.id,
      orgId: ctx.orgId,
      event: "stage_change",
      dedupeKey: stageChangeDedupeKey(targetStage.id),
      context: { stageName: targetStage.name },
    })
  );

  return NextResponse.json({ status: "comissao_paga", stageId: targetStage.id });
}
