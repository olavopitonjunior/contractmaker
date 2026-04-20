import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { requireElevation, ElevationRequiredError } from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";
import { sendEmail } from "@/lib/email/client";
import { MemberInvitedEmail } from "@/lib/email/templates/member-invited";
import { generateSecureToken } from "@/lib/security/crypto";

const ROLE_VALUES = ["admin", "finance", "sales", "viewer"] as const;

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLE_VALUES),
  customRoleId: z.string().optional(),
  name: z.string().optional(),
});

/**
 * GET /api/org/members — lista membros da org.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const members = await prisma.orgMembership.findMany({
    where: { orgId: ctx.orgId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      customRole: { select: { id: true, name: true } },
    },
    orderBy: { invitedAt: "asc" },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      customRoleId: m.customRoleId,
      customRoleName: m.customRole?.name ?? null,
      invitedAt: m.invitedAt,
      lastActiveAt: m.lastActiveAt,
      user: m.user,
    })),
  });
}

/**
 * POST /api/org/members — convida novo membro (cria user + membership).
 * Exige elevation MEMBER_MANAGE + permission org.members.invite.
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
    await requireElevation(ctx.userId, "MEMBER_MANAGE");
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError ||
      err instanceof ElevationRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const { email, role, customRoleId, name } = parsed.data;

  // Cria user se não existir (senha temporária aleatória — user redefine via email)
  const tempPassword = generateSecureToken(16);
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: name ?? null, passwordHash },
    update: {},
  });

  // Checa se já é membro
  const existingMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId: ctx.orgId } },
  });
  if (existingMembership) {
    return NextResponse.json(
      { error: "Este usuário já é membro da organização" },
      { status: 409 }
    );
  }

  // Se customRoleId fornecido, valida que pertence à org
  if (customRoleId) {
    const role = await prisma.customRole.findFirst({
      where: { id: customRoleId, orgId: ctx.orgId },
    });
    if (!role) {
      return NextResponse.json(
        { error: "Role customizado inválido" },
        { status: 400 }
      );
    }
  }

  const membership = await prisma.orgMembership.create({
    data: {
      userId: user.id,
      orgId: ctx.orgId,
      role,
      customRoleId: customRoleId ?? null,
      invitedBy: ctx.userId,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "MEMBER_INVITED",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${membership.id}`,
      metadata: { invitedUserId: user.id, role },
    }
  );

  // Envia email com link para o login (user define senha nova)
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const acceptUrl = `${baseUrl}/login?email=${encodeURIComponent(email)}`;

  await sendEmail({
    to: email,
    subject: `Convite para ${ctx.orgName} no Contractmaker`,
    react: MemberInvitedEmail({
      inviterName: ctx.userName,
      orgName: ctx.orgName,
      role,
      acceptUrl,
    }) as any,
  });

  return NextResponse.json({
    membership: {
      id: membership.id,
      userId: user.id,
      role: membership.role,
      email,
    },
  });
}
