import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION, ALL_PERMISSIONS } from "@/lib/security/rbac/permissions";
import { requireElevation, ElevationRequiredError } from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";

const permissionKeySchema = z.string().refine(
  (k) => ALL_PERMISSIONS.includes(k as any),
  "Invalid permission key"
);

const patchSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  description: z.string().max(200).nullable().optional(),
  permissions: z.record(permissionKeySchema, z.boolean()).optional(),
});

async function guardFees(userId: string, orgId: string) {
  await requirePermission({
    userId,
    orgId,
    permission: PERMISSION.ORG_MEMBERS_CHANGE_ROLE,
  });
  await requireElevation(userId, "MEMBER_MANAGE");
}

/**
 * PATCH /api/org/custom-roles/[id]
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await guardFees(ctx.userId, ctx.orgId);
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

  const role = await prisma.customRole.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!role) {
    return NextResponse.json({ error: "Role não encontrado" }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const updated = await prisma.customRole.update({
    where: { id },
    data: {
      name: parsed.data.name ?? role.name,
      description:
        parsed.data.description === undefined ? role.description : parsed.data.description,
      permissions: parsed.data.permissions
        ? (parsed.data.permissions as any)
        : role.permissions,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "CUSTOM_ROLE_UPDATED",
      result: "SUCCESS",
      resourceType: "custom_role",
      resource: `custom_role:${id}`,
    }
  );

  return NextResponse.json({ role: updated });
}

/**
 * DELETE /api/org/custom-roles/[id]
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await guardFees(ctx.userId, ctx.orgId);
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

  const role = await prisma.customRole.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { _count: { select: { members: true } } },
  });
  if (!role) {
    return NextResponse.json({ error: "Role não encontrado" }, { status: 404 });
  }
  if (role._count.members > 0) {
    return NextResponse.json(
      { error: `Há ${role._count.members} membros usando este role` },
      { status: 409 }
    );
  }

  await prisma.customRole.delete({ where: { id } });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "CUSTOM_ROLE_DELETED",
      result: "SUCCESS",
      resourceType: "custom_role",
      resource: `custom_role:${id}`,
    }
  );

  return NextResponse.json({ ok: true });
}
