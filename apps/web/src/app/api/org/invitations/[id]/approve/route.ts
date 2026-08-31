import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/context";
import { audit } from "@/lib/security/audit";
import { sendEmail } from "@/lib/email/client";
import { InvitationApprovedEmail } from "@/lib/email/templates/invitation-approved";
import { canApproveInvitationForRole } from "@/lib/auth/invitations";
import { createPasswordResetToken } from "@/lib/auth/password-reset";

/**
 * POST /api/org/invitations/:id/approve — aprova convite, cria User +
 * OrgMembership, e dispara e-mail de primeiro acesso.
 *
 * Quem ainda não tem senha (caso normal: conta criada aqui) recebe link de
 * /reset-password?token= com reason `welcome` e DEFINE a senha na hora. Quem
 * já tinha conta com senha recebe só o link de login.
 *
 * Gate: quem tem a permissão `org.members.approve` na org — presets `owner` e
 * `admin` a carregam — ou um email da allowlist INVITE_APPROVER_EMAILS
 * (default olavo.piton@gmail.com), MAIS o teto de papel. Ver
 * `canApproveInvitationForRole`.
 *
 * As duas checagens são uma chamada só, depois de carregar o convite: o teto
 * precisa de `invitation.role`, e separá-las custava dois lookups idênticos de
 * permissões efetivas por aprovação. O preço é que quem não pode aprovar
 * distingue convite inexistente (404) de existente (403) dentro da PRÓPRIA org
 * — informação de valor desprezível para quem já é membro autenticado dela.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

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

  // Teto de papel, DEPOIS da expiração de propósito: aprovar concede o papel, e
  // sem isto quem tem invite+approve concederia `admin` a si mesmo. Mas pôr o
  // teto ANTES prenderia convite vencido acima do teto em `pending` para
  // sempre — 403 em vez de 410, `status` nunca vira `expired`, e daí
  // `findPendingInvitation` passa a devolver 409 em todo reconvite daquele
  // e-mail, inclusive com papel menor. Depende de `invitation.role`, por isso
  // não cabe no gate lá em cima.
  const ceiling = await canApproveInvitationForRole({
    userId: ctx.userId,
    orgId: ctx.orgId,
    email: ctx.userEmail,
    impersonatedByUserId: ctx.impersonatedByUserId,
    impersonatedByEmail: ctx.impersonatedByEmail,
    targetRole: invitation.role,
  });
  if (!ceiling.allowed) {
    return NextResponse.json(
      {
        error:
          ceiling.reason === "role_ceiling"
            ? `Você não pode conceder o papel "${invitation.role}" — ele tem permissões que você não possui`
            : "Você não tem permissão para aprovar acessos",
      },
      { status: 403 }
    );
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
        // Quem DECIDIU, não quem o RBAC resolveu. Sob impersonation de tenant
        // `ctx.userId` é o DONO do tenant (ele é quem resolve membership/RBAC),
        // então gravá-lo aqui registraria que o cliente admitiu o próprio
        // membro quando na verdade foi o operador da plataforma. O AuditLog
        // carimba `impersonatedBy` no metadata, mas esta coluna não tem esse
        // par — sem isto, o "aprovado por" mente e não há de onde recuperar.
        approvedById: ctx.impersonatedByUserId ?? ctx.userId,
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

  // `passwordHash != null` NÃO significa "sabe a senha": provisionamento de
  // tenant (api/admin/orgs) e api/org/members criam a conta com hash aleatório
  // de placeholder. Quem nunca autenticou em org nenhuma cai nesse caso — e
  // mandar "use sua senha de sempre" pra essa pessoa é o mesmo beco sem saída
  // que este fluxo existe pra fechar.
  //
  // A membership desta org acabou de ser criada com lastActiveAt null, então
  // o count só enxerga atividade anterior e real.
  const previousActivity = await prisma.orgMembership.count({
    where: { userId: result.user.id, lastActiveAt: { not: null } },
  });
  // Erra pro lado seguro: na dúvida manda o link que CRIA a senha — ele
  // funciona mesmo pra quem já tinha uma. O inverso tranca a pessoa do lado
  // de fora.
  const needsPassword = !result.user.passwordHash || previousActivity === 0;
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
