import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  newParticipantToken,
  type ParticipantRole,
} from "@/lib/forms/participant-token";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/forms/[id]/participants/[participantId]/regenerate
 *
 * Admin clica "Regenerar link" — o token antigo é substituído no DB e vira 401
 * na hora (`SalesFormParticipant.token` é o canônico).
 *
 * Útil quando o link vazou (encaminhado por erro), ou quando o admin
 * quer prolongar prazo após os 7d expirarem.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string; participantId: string } },
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  // Cross-org guard: form precisa pertencer à org do ctx, e participant
  // precisa pertencer ao form. `[token]` é o SalesForm.token (lookup único).
  const form = await prisma.salesForm.findFirst({
    where: { token: params.token, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }

  const participant = await prisma.salesFormParticipant.findFirst({
    where: { id: params.participantId, formId: form.id },
  });
  if (!participant) {
    return NextResponse.json(
      { error: "Participant não encontrado" },
      { status: 404 },
    );
  }

  const role = participant.role as ParticipantRole;
  const { token, exp } = newParticipantToken();

  const updated = await prisma.salesFormParticipant.update({
    where: { id: participant.id },
    data: { token, tokenExp: exp },
  });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "PARTICIPANT_LINK_REGENERATED",
      result: "SUCCESS",
      resourceType: "SalesFormParticipant",
      resource: participant.id,
      metadata: {
        role,
        formId: form.id,
        previousTokenExp: participant.tokenExp.toISOString(),
      },
    },
  );

  return NextResponse.json({
    id: updated.id,
    role: updated.role,
    partyIndex: updated.partyIndex,
    token: updated.token,
    tokenExp: updated.tokenExp.toISOString(),
    url: `/f/p/${updated.token}`,
  });
}
