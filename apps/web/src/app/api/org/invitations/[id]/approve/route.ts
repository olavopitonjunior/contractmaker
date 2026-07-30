import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/context";
import { audit } from "@/lib/security/audit";
import { sendEmail } from "@/lib/email/client";
import { InvitationApprovedEmail } from "@/lib/email/templates/invitation-approved";
import { isApprover } from "@/lib/auth/invitations";
import { createPasswordResetToken } from "@/lib/auth/password-reset";

/**
 * POST /api/org/invitations/:id/approve — aprova convite, cria User +
 * OrgMembership, e dispara e-mail de primeiro acesso.
 *
 * Quem ainda não tem senha (caso normal: conta criada aqui) recebe link de
 * /reset-password?token= com reason `welcome` e DEFINE a senha na hora. Quem
 * já tinha conta com senha recebe só o link de login.
 *
 * Gate: apenas emails listados em INVITE_APPROVER_EMAILS (default
 * olavo.piton@gmail.com) podem aprovar.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  if (!isApprover(ctx.userEmail)) {
    return NextResponse.json(
      { error: "Apenas o aprovador designado pode aprovar convites" },
      { status: 403 }
    );
  }

  const invitation = await prisma.orgInvitation.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Convite não encontrado" }, { status: 404 });
  }
  if (invitation.status !== "pending") {
    return NextResponse.json(
      { error: `Convite não está pendente (status atual: ${invitation.status})` },
      { status: 409 }
    );
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    await prisma.orgInvitation.update({
      where: { id },
      data: { status: "expired" },
    });
    return NextResponse.json({ error: "Convite expirado" }, { status: 410 });
  }

  // Cria User + OrgMembership atomicamente. User existente (caso raro:
  // alguém com conta de outro contexto) só ganha membership.
  const result = await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });
    if (!user) {
      user = await tx.user.create({
        data: {
          email: invitation.email,
          name: invitation.name ?? null,
          // Sem passwordHash: a senha é criada pelo próprio convidado no
          // link de boas-vindas (/reset-password?token=), abaixo.
        },
        select: { id: true, email: true, name: true, passwordHash: true },
      });
    }

    const existingMembership = await tx.orgMembership.findUnique({
      where: { userId_orgId: { userId: user.id, orgId: ctx.orgId } },
      select: { id: true },
    });
    if (!existingMembership) {
      await tx.orgMembership.create({
        data: {
          userId: user.id,
          orgId: ctx.orgId,
          role: invitation.role,
          invitedBy: invitation.invitedById,
        },
      });
    }

    const updated = await tx.orgInvitation.update({
      where: { id },
      data: {
        status: "approved",
        approvedById: ctx.userId,
        approvedAt: new Date(),
      },
    });

    return { user, invitation: updated };
  });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "INVITATION_APPROVED",
      result: "SUCCESS",
      resourceType: "org_invitation",
      resource: `org_invitation:${id}`,
      metadata: { invitedUserId: result.user.id, email: invitation.email },
    }
  );

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  // Sem senha definida → link que CRIA a senha (não existe "senha atual" pra
  // pedir). Com senha → só login.
  const needsPassword = !result.user.passwordHash;
  let actionUrl = `${baseUrl}/login?email=${encodeURIComponent(invitation.email)}`;
  if (needsPassword) {
    const { token } = await createPasswordResetToken(invitation.email, "welcome");
    actionUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  // sendEmail NUNCA lança — devolve { ok:false }. Ler é obrigatório: esse
  // e-mail carrega o ÚNICO link de criação de senha, então falha silenciosa
  // deixa o convidado trancado do lado de fora com o aprovador achando que
  // deu certo.
  const sent = await sendEmail({
    to: invitation.email,
    subject: `Acesso aprovado — ${ctx.orgName}`,
    react: InvitationApprovedEmail({
      inviteeName: invitation.name,
      orgName: ctx.orgName,
      actionUrl,
      mode: needsPassword ? "set-password" : "login",
    }) as React.ReactElement,
  });

  if (!sent.ok) {
    console.error(
      "[invitations/approve] falha ao enviar e-mail de primeiro acesso",
      { invitationId: id, error: sent.error }
    );
  }

  return NextResponse.json({
    ok: true,
    userId: result.user.id,
    emailSent: sent.ok,
  });
}
