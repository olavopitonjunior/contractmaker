import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { requireApproval, approvalResponse } from "@/lib/api/intents";

/**
 * POST /api/envelopes/[id]/cancel
 *
 * Cria ActionIntent pra cancelar envelope ClickSign já enviado (HITL via
 * Bearer). Após aprovação humana via `/intents/<id>`, executor chama
 * ClickSign cancel API e marca `Envelope.status = "canceled"`.
 *
 * Auth: Bearer (scope `signatures:rw`) ou session. Cross-user via
 * `envelope.contract.userId` (ou `envelope.dealAttachment.deal.userId` quando
 * source=attachment).
 *
 * Bloqueia se envelope já está em estado terminal (closed, canceled, failed).
 *
 * Body: { reason: string }   (mínimo 3 chars, max 500)
 * Header: X-Idempotency-Key: <uuid v4>  (opcional)
 */

const bodySchema = z.object({
  reason: z.string().min(3).max(500),
});

const TERMINAL_STATUSES = new Set(["closed", "canceled", "failed"]);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "signatures:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { reason } = parsed.data;

  const envelope = await prisma.envelope.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      clicksignId: true,
      contractId: true,
      dealId: true,
      orgId: true,
      contract: { select: { userId: true } },
    },
  });
  if (!envelope) {
    return NextResponse.json(
      { error: "Envelope não encontrado" },
      { status: 404 }
    );
  }
  if (envelope.orgId !== apiAuth.org.id) {
    return NextResponse.json(
      { error: "Forbidden", reason: "envelope from another org" },
      { status: 403 }
    );
  }
  // Cross-user guard pra Bearer: precisa ser dono do contract (quando há)
  if (
    apiAuth.ident.via === "bearer" &&
    envelope.contract &&
    envelope.contract.userId !== apiAuth.ident.userId
  ) {
    return NextResponse.json(
      { error: "Forbidden", reason: "not the contract owner" },
      { status: 403 }
    );
  }
  if (TERMINAL_STATUSES.has(envelope.status)) {
    return NextResponse.json(
      {
        error: `Envelope já está em estado terminal (${envelope.status}); não pode ser cancelado`,
      },
      { status: 409 }
    );
  }
  if (!envelope.clicksignId) {
    return NextResponse.json(
      {
        error:
          "Envelope ainda não foi enviado para ClickSign (clicksignId ausente). Use draft delete em vez de cancel.",
      },
      { status: 422 }
    );
  }

  const idempotencyKey = req.headers.get("x-idempotency-key");

  const result = await requireApproval<unknown>({
    ctx: apiAuth,
    action: "ENVELOPE_CANCEL",
    payload: { envelopeId: params.id, reason },
    preview: {
      summary: `Cancelar envelope ${params.id} (${envelope.clicksignId})`,
      details: {
        envelopeId: params.id,
        clicksignId: envelope.clicksignId,
        reason,
        currentStatus: envelope.status,
      },
    },
    req,
    idempotencyKey,
    run: async () => {
      const { runEnvelopeCancel } = await import(
        "@/lib/clicksign/cancel-action"
      );
      return runEnvelopeCancel({
        envelopeId: params.id,
        reason,
        actorUserId: apiAuth.actor.effectiveUserId,
      });
    },
  });

  return approvalResponse(result);
}
