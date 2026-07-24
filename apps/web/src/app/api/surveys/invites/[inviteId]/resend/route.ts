import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { ModuleDisabledError } from "@/lib/modules/guard";
import { assertAnySurveyFeature } from "@/lib/surveys/guard";
import { sendSurveyInvite } from "@/lib/surveys/channels";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/surveys/invites/[inviteId]/resend — reenvia o MESMO token
// (renova só a expiração; regenerar token invalidaria o link já na mão do
// destinatário sem ganho de segurança).
export async function POST(
  req: NextRequest,
  { params }: { params: { inviteId: string } }
) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);
  try {
    await assertAnySurveyFeature(auth.org.id);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const invite = await prisma.surveyInvite.findFirst({
    where: { id: params.inviteId, orgId: auth.org.id },
    include: {
      template: { select: { name: true, status: true } },
      deal: { select: { id: true, kind: true, userId: true } },
    },
  });
  if (!invite) {
    return NextResponse.json({ error: "Envio não encontrado" }, { status: 404 });
  }
  if (invite.status === "responded" || invite.status === "optout") {
    return NextResponse.json(
      { error: "Este destinatário já respondeu ou cancelou o recebimento" },
      { status: 409 }
    );
  }
  if (invite.channel !== "email" && invite.channel !== "whatsapp") {
    return NextResponse.json(
      { error: "Reenvio disponível apenas pra envios por e-mail ou WhatsApp" },
      { status: 400 }
    );
  }

  // Renova a validade do link e volta pro fluxo normal de envio.
  const refreshed = await prisma.surveyInvite.update({
    where: { id: invite.id },
    data: {
      tokenExp: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: invite.status === "expired" || invite.status === "failed" ? "pending" : invite.status,
    },
  });

  const sent = await sendSurveyInvite({
    invite: refreshed,
    templateName: invite.template.name,
    orgId: auth.org.id,
    deal: invite.deal
      ? {
          id: invite.deal.id,
          kind: invite.deal.kind === "locacao" ? "locacao" : "venda",
          userId: invite.deal.userId,
        }
      : null,
  });
  if (!sent.ok) {
    return NextResponse.json({ error: sent.reason }, { status: 502 });
  }

  void audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
    action: "SURVEY_INVITE_SENT",
    result: "SUCCESS",
    resource: invite.id,
    resourceType: "SurveyInvite",
    metadata: { resend: true, templateId: invite.templateId },
  });

  return NextResponse.json({ ok: true });
}
