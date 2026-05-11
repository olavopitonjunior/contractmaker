import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import {
  ACCOUNT_CAPABILITIES,
  type AccountCapability,
} from "@/lib/asaas/account";

/**
 * GET /api/financeiro/accounts/[id]/permissions
 * Lista membros da org + capabilities atuais por user. Owner aparece
 * read-only com badge "implícito".
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ACCOUNT_PERMISSIONS_MANAGE,
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

  const account = await prisma.asaasAccount.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const memberships = await prisma.orgMembership.findMany({
    where: { orgId: ctx.orgId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { invitedAt: "asc" },
  });
  const grants = await prisma.asaasAccountPermission.findMany({
    where: { accountId: id },
    select: { userId: true, capability: true, grantedBy: true, createdAt: true },
  });
  const grantsByUser = new Map<string, AccountCapability[]>();
  for (const g of grants) {
    const arr = grantsByUser.get(g.userId) ?? [];
    arr.push(g.capability as AccountCapability);
    grantsByUser.set(g.userId, arr);
  }

  return NextResponse.json({
    accountId: id,
    capabilities: ACCOUNT_CAPABILITIES,
    members: memberships.map((m) => ({
      userId: m.userId,
      name: m.user.name ?? m.user.email,
      email: m.user.email,
      role: m.role,
      isOwner: m.role === "owner",
      capabilities:
        m.role === "owner"
          ? [...ACCOUNT_CAPABILITIES] // owner herda implicitamente
          : grantsByUser.get(m.userId) ?? [],
    })),
  });
}

const putSchema = z.object({
  userId: z.string().min(1),
  capabilities: z.array(z.enum(ACCOUNT_CAPABILITIES as [AccountCapability, ...AccountCapability[]])),
});

/**
 * PUT /api/financeiro/accounts/[id]/permissions
 * Body { userId, capabilities[] } — sobrescreve grants do user.
 * Diff vs estado atual produz GRANT/REVOKE audit entries.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ACCOUNT_PERMISSIONS_MANAGE,
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

  const account = await prisma.asaasAccount.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // Target precisa ser membro da org
  const target = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: parsed.data.userId, orgId: ctx.orgId } },
    select: { role: true },
  });
  if (!target) {
    return NextResponse.json(
      { error: "Usuário alvo não é membro da organização" },
      { status: 400 }
    );
  }
  if (target.role === "owner") {
    return NextResponse.json(
      {
        error: "Owner já tem todas as capabilities implicitamente",
        code: "OWNER_IMPLICIT",
      },
      { status: 400 }
    );
  }

  const existing = await prisma.asaasAccountPermission.findMany({
    where: { accountId: id, userId: parsed.data.userId },
    select: { capability: true },
  });
  const have = new Set(existing.map((e) => e.capability));
  const want = new Set(parsed.data.capabilities);

  const toGrant = parsed.data.capabilities.filter((c) => !have.has(c));
  const toRevoke = [...have].filter((c) => !want.has(c as AccountCapability));

  if (toGrant.length > 0) {
    await prisma.asaasAccountPermission.createMany({
      data: toGrant.map((cap) => ({
        accountId: id,
        userId: parsed.data.userId,
        capability: cap,
        grantedBy: ctx.userId,
      })),
      skipDuplicates: true,
    });
  }
  if (toRevoke.length > 0) {
    await prisma.asaasAccountPermission.deleteMany({
      where: {
        accountId: id,
        userId: parsed.data.userId,
        capability: { in: toRevoke },
      },
    });
  }

  for (const cap of toGrant) {
    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "ACCOUNT_PERMISSION_GRANT",
        result: "SUCCESS",
        resourceType: "asaas_account_permission",
        resource: `asaas_account:${id}:${parsed.data.userId}`,
        metadata: { capability: cap },
      }
    );
  }
  for (const cap of toRevoke) {
    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "ACCOUNT_PERMISSION_REVOKE",
        result: "SUCCESS",
        resourceType: "asaas_account_permission",
        resource: `asaas_account:${id}:${parsed.data.userId}`,
        metadata: { capability: cap },
      }
    );
  }

  return NextResponse.json({ ok: true, granted: toGrant, revoked: toRevoke });
}

export const runtime = "nodejs";
