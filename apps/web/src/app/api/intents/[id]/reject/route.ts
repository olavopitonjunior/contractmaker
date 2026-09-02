import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { guardPermission } from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

/**
 * POST /api/intents/[id]/reject — session-only.
 * Body opcional: { reason: string }
 */
const rejectSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  if (auth.ident.via !== "session") {
    return NextResponse.json(
      { error: "Forbidden", reason: "intent rejection requires session auth" },
      { status: 403 }
    );
  }

  // Rejeitar é a OUTRA METADE da mesma decisão humana, e estava tão aberta
  // quanto aprovar: sessão + mesma org, e nada mais. Gatear só o approve
  // deixaria o buraco espelhado de pé — e o de rejeitar é um veto silencioso.
  // `/intents` lista todas as intents da org para qualquer membro, então os
  // ids estão à mão: um `viewer` percorria a fila e matava pedidos legítimos
  // (`ENVELOPE_SEND`, `PROPOSAL_CONVERT`) levando cada um ao estado terminal
  // `rejected`. O agente externo via o pedido morrer sem explicação, e a
  // negativa ficava atribuída ao papel que existe justamente para não mexer
  // em nada.
  //
  // Mesma chave do approve, de propósito: a decisão é uma só, e quem pode
  // dizer sim é quem pode dizer não.
  const denied = await guardPermission({
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    permission: PERMISSION.NEWTON_INTENT_APPROVE,
    message: "Você não tem permissão para decidir sobre esta ação.",
  });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const intent = await prisma.actionIntent.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orgId: true,
      requestedBy: true,
      action: true,
      status: true,
    },
  });
  if (!intent) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  if (intent.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  if (intent.status !== "pending") {
    return NextResponse.json(
      {
        error: "Conflict",
        reason: `intent status is ${intent.status} (expected pending)`,
      },
      { status: 409 }
    );
  }

  await prisma.actionIntent.update({
    where: { id: params.id },
    data: {
      status: "rejected",
      // Ator autorizado, como no approve — ver o comentário de lá.
      rejectedBy: auth.actor.effectiveUserId,
      rejectionReason: parsed.data.reason ?? null,
    },
  });

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.ident.userId),
    {
      action: "INTENT_REJECTED",
      result: "SUCCESS",
      resource: params.id,
      resourceType: "ActionIntent",
      metadata: mergeAuditMetadata(
        {
          intentAction: intent.action,
          requestedBy: intent.requestedBy,
          reason: parsed.data.reason ?? null,
        },
        auth.actor
      ),
    }
  );

  return NextResponse.json({ ok: true, intentId: params.id });
}
