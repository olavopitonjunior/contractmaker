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
  defaultInvitationExpiry,
  findPendingInvitation,
  getApproverEmails,
  getNotifyEmails,
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
      invitedById: ctx.userId,
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

  // Notificações: approvers recebem CTA; notify-only só ciência.
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const reviewUrl = `${baseUrl}/settings/membros?tab=convites`;
  const approverEmails = getApproverEmails();
  const notifyEmails = getNotifyEmails().filter(
    (e) => !approverEmails.includes(e)
  );

  await Promise.allSettled([
    ...approverEmails.map((to) =>
      sendEmail({
        to,
        subject: `Novo convite aguarda aprovação — ${ctx.orgName}`,
        react: InvitationPendingEmail({
          inviterName: ctx.userName,
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
          inviterName: ctx.userName,
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
