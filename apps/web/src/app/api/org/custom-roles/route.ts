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

const createSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(200).optional(),
  permissions: z.record(permissionKeySchema, z.boolean()),
});

/**
 * GET /api/org/custom-roles — lista roles customizados da org.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const roles = await prisma.customRole.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json({
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      memberCount: r._count.members,
      createdAt: r.createdAt,
    })),
  });
}

/**
 * POST /api/org/custom-roles — cria role customizado.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_MEMBERS_CHANGE_ROLE,
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
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  try {
    const role = await prisma.customRole.create({
      data: {
        orgId: ctx.orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        permissions: parsed.data.permissions as any,
        createdBy: ctx.userId,
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CUSTOM_ROLE_CREATED",
        result: "SUCCESS",
        resourceType: "custom_role",
        resource: `custom_role:${role.id}`,
        metadata: { name: role.name },
      }
    );

    return NextResponse.json({ role });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "Já existe um role com este nome" },
        { status: 409 }
      );
    }
    throw err;
  }
}
