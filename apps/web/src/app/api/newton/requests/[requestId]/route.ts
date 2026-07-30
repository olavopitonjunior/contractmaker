import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { newtonDisabledResponse } from "@/lib/newton/gate";
import { appendEvent, serializeRequest } from "@/lib/newton/requests";
import { emitNotification } from "@/lib/notifications/emit";

export const runtime = "nodejs";

/**
 * PATCH /api/newton/requests/:requestId
 *
 * Newton (Bearer) atualiza o andamento de uma pendência. `action` controla a
 * transição de status e dispara efeitos:
 *
 *   - chasing   — legado. Desde 2026-07-25 o Newton não cobra por iniciativa
 *                 própria; só chega aqui se o próprio operador pediu, em DM.
 *                 Opcional cronJobIds, marca lastNudgeAt.
 *   - awaiting  — aguardando resposta.
 *   - fulfilled — info chegou; grava resolutionNote, emite Notification in-app
 *                 para a negociadora e fecha. **A notificação in-app é o aviso** —
 *                 o Newton não manda DM avisando por conta própria.
 *   - note      — só registra um evento na timeline (sem mudar status).
 */
const patchSchema = z.object({
  action: z.enum(["chasing", "awaiting", "fulfilled", "note"]),
  note: z.string().trim().max(1000).optional(),
  resolutionNote: z.string().trim().max(2000).optional(),
  // ids de crons de lembrete que o Newton criou (acumula, dedupe).
  cronJobIds: z.array(z.string().max(128)).max(20).optional(),
});

const ACTION_STATUS: Record<string, string | null> = {
  chasing: "chasing",
  awaiting: "awaiting_reply",
  fulfilled: "fulfilled",
  note: null, // não muda status
};

const ACTION_EVENT: Record<string, string> = {
  chasing: "chased",
  awaiting: "awaiting_reply",
  fulfilled: "fulfilled",
  note: "note",
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  // Tenant sem Newton (default do catálogo) não fala com o agente.
  const newtonOff = await newtonDisabledResponse(auth.org.id);
  if (newtonOff) return newtonOff;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { action, note, resolutionNote, cronJobIds } = parsed.data;

  const existing = await prisma.newtonRequest.findUnique({
    where: { id: params.requestId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (existing.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (existing.status === "cancelled") {
    return NextResponse.json({ error: "Pedido cancelado" }, { status: 409 });
  }

  const nextStatus = ACTION_STATUS[action];
  // União dedupe dos cronJobIds.
  const mergedCronIds = cronJobIds
    ? Array.from(new Set([...existing.cronJobIds, ...cronJobIds]))
    : existing.cronJobIds;

  const updated = await prisma.newtonRequest.update({
    where: { id: existing.id },
    data: {
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(action === "chasing" ? { lastNudgeAt: new Date() } : {}),
      ...(action === "fulfilled" && resolutionNote ? { resolutionNote } : {}),
      cronJobIds: mergedCronIds,
      eventsJson: appendEvent(existing.eventsJson, {
        actor: "newton",
        type: ACTION_EVENT[action],
        note: action === "fulfilled" ? resolutionNote ?? note : note,
      }),
    },
  });

  // Fechamento → avisa a negociadora in-app (timeline já registrada acima).
  if (action === "fulfilled") {
    waitUntil(emitNotification({
      orgId: existing.orgId,
      userId: existing.createdBy,
      type: "newton_request_fulfilled",
      title: "Newton conseguiu a informação que você pediu",
      body: resolutionNote ?? existing.ask,
      linkUrl: `/deals/${existing.dealId}`,
      metadata: { dealId: existing.dealId, requestId: existing.id },
    }));
  }

  return NextResponse.json(serializeRequest(updated));
}
