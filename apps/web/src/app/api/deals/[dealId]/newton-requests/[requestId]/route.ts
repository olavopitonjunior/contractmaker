import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { appendEvent, serializeRequest } from "@/lib/newton/requests";
import { triggerNewtonForRequest } from "@/lib/newton/trigger";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

/**
 * PATCH /api/deals/:dealId/newton-requests/:requestId
 *
 * Ação da negociadora pela UI. v1: cancelar o pedido. Ao cancelar, dispara um
 * turn pedindo ao Newton que derrube os lembretes vinculados (o web não fala
 * com o cron do gateway diretamente).
 */
const patchSchema = z.object({
  action: z.literal("cancel"),
  note: z.string().trim().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string; requestId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.newtonRequest.findUnique({
    where: { id: params.requestId },
  });
  if (!existing || existing.dealId !== params.dealId) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (existing.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    via: auth.ident.via,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  if (existing.status === "fulfilled" || existing.status === "cancelled") {
    return NextResponse.json(
      { error: `Pedido já está ${existing.status}` },
      { status: 409 }
    );
  }

  const updated = await prisma.newtonRequest.update({
    where: { id: existing.id },
    data: {
      status: "cancelled",
      eventsJson: appendEvent(existing.eventsJson, {
        actor: "negociadora",
        type: "cancelled",
        note: parsed.data.note,
      }),
    },
  });

  // Pede ao Newton para derrubar os lembretes (só se havia algum agendado).
  if (existing.cronJobIds.length > 0) {
    waitUntil(triggerNewtonForRequest({
      orgId: existing.orgId,
      dealId: params.dealId,
      requestId: existing.id,
      ask: existing.ask,
      targetType: existing.targetType,
      targetRef: existing.targetRef,
      targetLabel: existing.targetLabel,
      kind: "cancel",
    }));
  }

  return NextResponse.json(serializeRequest(updated));
}
