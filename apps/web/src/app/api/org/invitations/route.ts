import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/context";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { sendEmail } from "@/lib/email/client";
import { InvitationPendingEmail } from "@/lib/email/templates/invitation-pending";
import {
  canGrantRole,
  defaultInvitationExpiry,
  findPendingInvitation,
  getApproverEmails,
  getNotifyEmails,
  getOrgApproverEmails,
  isApprover,
} from "@/lib/auth/invitations";
import {
  createInvitationSchema,
  formatInvitationValidationError,
} from "@/lib/auth/invitation-schema";

/**
 * GET /api/org/invitations — lista convites da org. Filtro ?status=pending.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  // O operador da allowlist de env pode não ter membership nenhuma nesta org —
  // é o caso que a porta de emergência existe para servir, e `/api/auth/
  // permissions` já lhe acende o botão de aprovar. Sem esta saída ele veria a
  // aba renderizar e a lista responder 403: porta aberta no gate de decisão e
  // fechada na leitura, que é meia porta.
  const platformOperator = isApprover(
    ctx.impersonatedByUserId ? ctx.impersonatedByEmail : ctx.userEmail
  );
  if (!platformOperator) {
    try {
      await requirePermission({
        userId: ctx.userId,
        orgId: ctx.orgId,
        permission: PERMISSION.ORG_MEMBERS_INVITE,
      });
    } catch (err) {
      if (
        err instanceof PermissionDeniedError ||
        err instanceof MembershipRequiredError
      ) {
        return NextResponse.json({ error: err.code }, { status: err.status });
      }
      throw err;
    }
  }

  const status = req.nextUrl.searchParams.get("status");
  const invitations = await prisma.orgInvitation.findMany({
    where: { orgId: ctx.orgId, ...(status ? { status } : {}) },
    include: {
      invitedBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ invitations });
}

/**
 * POST /api/org/invitations — cria convite com status="pending". Não cria
 * User. Manda email para approvers e notify-only.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_MEMBERS_INVITE,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = createInvitationSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: formatInvitationValidationError(parsed.error),
        details: parsed.error.format(),
      },
      { status: 400 }
    );
  }
  const email = parsed.data.email.toLowerCase().trim();
  const { name, role } = parsed.data;

  // Teto de papel NA CRIAÇÃO (issue #474). A segurança nunca dependeu disto — o
  // teto do `approve` é que decide, e é lá que a membership nasce —, mas sem
  // esta porta o convite acima do teto era aceito com 201 e morria calado na
  // aprovação: o convidador achava que deu certo, o aprovador tomava 403 e o
  // convidado nunca recebia nada.
  //
  // Vem ANTES das checagens de existência de propósito: é a decisão mais
  // barata e não revela a quem sequer pode conceder o papel se o e-mail já é
  // membro da org.
  //
  // `ctx.userId` (não o impersonador): sob impersonation quem age dentro do
  // tenant é o dono dele, e o operador de plataforma não tem membership nesta
  // org — medir o teto por ele daria o resultado errado. Mesmo critério do
  // `POST /api/org/members`.
  //
  // O schema de convite não aceita `custom`, então não há CustomRole a
  // resolver aqui; `canGrantRole` recebe o alvo por papel.
  const ceiling = await canGrantRole({
    userId: ctx.userId,
    orgId: ctx.orgId,
    targetRole: role,
  });
  if (!ceiling.allowed) {
    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "INVITATION_CREATED",
        result: "DENIED",
        resourceType: "org_invitation",
        metadata: { email, role, reason: ceiling.reason },
      }
    );
    return NextResponse.json(
      {
        error: `Você não pode conceder o papel "${role}" — ele tem permissões que você não possui`,
      },
      { status: 403 }
    );
  }

  // Bloqueia se já é membro
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    const existingMembership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: existingUser.id, orgId: ctx.orgId } },
      select: { id: true },
    });
    if (existingMembership) {
      return NextResponse.json(
        { error: "Este usuário já é membro da organização" },
        { status: 409 }
      );
    }
  }

  // Bloqueia se já tem convite pendente
  const existingPending = await findPendingInvitation(ctx.orgId, email);
  if (existingPending) {
    return NextResponse.json(
      { error: "Já existe um convite pendente para este email" },
      { status: 409 }
    );
  }

  const invitation = await prisma.orgInvitation.create({
    data: {
      orgId: ctx.orgId,
      email,
      name: name ?? null,
      role,
      status: "pending",
      // Mesma razão de `approvedById` no approve: sob impersonation `ctx.userId`
      // é o DONO do tenant, e a coluna vira "Convidado por" na tela de membros.
      // Depois deste PR `approvedById` diz a verdade; deixar a metade irmã
      // mentindo seria inconsistência conhecida na mesma linha da mesma tabela.
      invitedById: ctx.impersonatedByUserId ?? ctx.userId,
      expiresAt: defaultInvitationExpiry(),
    },
  });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "INVITATION_CREATED",
      result: "SUCCESS",
      resourceType: "org_invitation",
      resource: `org_invitation:${invitation.id}`,
      metadata: { email, role },
    }
  );

  // Notificações: quem decide recebe CTA; notify-only só ciência.
  //
  // "Quem decide" é a mesma união que `canApproveInvitations` aplica no gate:
  // a allowlist de env MAIS os membros com `org.members.approve` (owner/admin).
  // Sem os segundos, o admin ganharia o botão e nunca saberia que há fila.
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const reviewUrl = `${baseUrl}/settings/membros?tab=convites`;

  // O convite JÁ está commitado a esta altura. Antes deste bloco só ler env,
  // ele não podia lançar; agora há um round-trip ao banco, e deixá-lo estourar
  // devolveria 500 com o convite gravado como `pending` e ninguém avisado — o
  // `allSettled` abaixo nem chegaria a rodar. Na retentativa o admin levaria
  // 409 "já existe um convite pendente". Notificação é best-effort: degradar
  // para a allowlist de env é pior que o ideal e muito melhor que encalhar.
  let orgApprovers: string[] = [];
  try {
    orgApprovers = await getOrgApproverEmails(ctx.orgId);
  } catch (err) {
    console.error(
      "[invitations] falha ao resolver aprovadores da org — notificando só a allowlist de env",
      { orgId: ctx.orgId, invitationId: invitation.id, error: err }
    );
  }

  // Fora o criador: ele acabou de agir e já está na tela; mandar-lhe um CTA
  // "aguarda aprovação" sobre a própria ação é ruído que este PR introduziria
  // (owner/admin carregam invite E approve, então ele cairia sempre na lista).
  //
  // O ator real, pela mesma razão de `invitedById` acima. Usar `ctx.userEmail`
  // aqui INVERTIA a intenção sob impersonação: removia o dono do tenant, que
  // não agiu e é justamente quem precisa saber que há fila na org dele, e
  // mandava o CTA ao operador, que acabou de criar o convite.
  const inviterEmail = (ctx.impersonatedByEmail ?? ctx.userEmail)?.toLowerCase();
  // `ctx.userName` é o nome do DONO sob impersonação, e não há `...ByName` no
  // ctx. Sem isto o e-mail diria que o dono convidou enquanto a tela de membros
  // (que lê `invitedById`) diz que foi o operador — duas versões do mesmo fato.
  const inviterLabel = ctx.impersonatedByEmail ?? ctx.userName;
  const approverEmails = Array.from(
    new Set([...getApproverEmails(), ...orgApprovers])
  ).filter((e) => e !== inviterEmail);
  const notifyEmails = getNotifyEmails().filter(
    (e) => !approverEmails.includes(e) && e !== inviterEmail
  );

  await Promise.allSettled([
    ...approverEmails.map((to) =>
      sendEmail({
        to,
        subject: `Novo convite aguarda aprovação — ${ctx.orgName}`,
        react: InvitationPendingEmail({
          inviterName: inviterLabel,
          inviteeName: name ?? null,
          inviteeEmail: email,
          orgName: ctx.orgName,
          reviewUrl,
          isApprover: true,
        }) as React.ReactElement,
      })
    ),
    ...notifyEmails.map((to) =>
      sendEmail({
        to,
        subject: `Novo convite criado em ${ctx.orgName}`,
        react: InvitationPendingEmail({
          inviterName: inviterLabel,
          inviteeName: name ?? null,
          inviteeEmail: email,
          orgName: ctx.orgName,
          reviewUrl,
          isApprover: false,
        }) as React.ReactElement,
      })
    ),
  ]);

  return NextResponse.json({ invitation }, { status: 201 });
}
