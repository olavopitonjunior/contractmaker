import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import {
  PERMISSION,
  MANAGER_CONFIGURABLE_PERMISSIONS,
} from "@/lib/security/rbac/permissions";
import { requireElevation, ElevationRequiredError } from "@/lib/security/elevation";
import { getManagerSettings } from "@/lib/deals/manager";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";

const managerPermissionKeySchema = z
  .string()
  .refine(
    (k) => (MANAGER_CONFIGURABLE_PERMISSIONS as string[]).includes(k),
    "Permissão fora do conjunto configurável de gerentes"
  );

const patchSchema = z
  .object({
    managerRequired: z.boolean().optional(),
    permissions: z.record(managerPermissionKeySchema, z.boolean()).optional(),
  })
  .strict();

/**
 * GET /api/org/manager-settings — config de gerentes da org.
 * Row ausente → defaults (managerRequired=false, permissions={}) SEM criar row.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_SETTINGS_READ,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const settings = await getManagerSettings(ctx.orgId);
  return NextResponse.json({
    managerRequired: settings.managerRequired,
    permissions: settings.permissionsJson,
    configurable: MANAGER_CONFIGURABLE_PERMISSIONS,
  });
}

/**
 * PATCH /api/org/manager-settings — upsert do toggle de obrigatoriedade e/ou
 * dos overrides de permissão dos gerentes. Conceder permissão é gestão de
 * role → mesmo guard de custom-roles: ORG_MEMBERS_CHANGE_ROLE + elevation
 * MEMBER_MANAGE. Chaves fora de MANAGER_CONFIGURABLE_PERMISSIONS → 400.
 */
export async function PATCH(req: NextRequest) {
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
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  if (
    parsed.data.managerRequired === undefined &&
    parsed.data.permissions === undefined
  ) {
    return NextResponse.json(
      { error: "Informe managerRequired e/ou permissions." },
      { status: 400 }
    );
  }

  const before = await getManagerSettings(ctx.orgId);
  const nextPermissions = parsed.data.permissions
    ? { ...before.permissionsJson, ...parsed.data.permissions }
    : before.permissionsJson;

  const updated = await prisma.orgManagerSettings.upsert({
    where: { orgId: ctx.orgId },
    create: {
      orgId: ctx.orgId,
      managerRequired: parsed.data.managerRequired ?? false,
      permissionsJson: nextPermissions,
    },
    update: {
      ...(parsed.data.managerRequired !== undefined
        ? { managerRequired: parsed.data.managerRequired }
        : {}),
      ...(parsed.data.permissions ? { permissionsJson: nextPermissions } : {}),
    },
    select: { managerRequired: true, permissionsJson: true },
  });

  // Diff das chaves alteradas — o audit registra só o que mudou.
  const changedPermissions: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(parsed.data.permissions ?? {})) {
    if (before.permissionsJson[k] !== v) changedPermissions[k] = v;
  }

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "ORG_MANAGER_SETTINGS_UPDATE",
      result: "SUCCESS",
      resourceType: "org_manager_settings",
      resource: ctx.orgId,
      metadata: {
        ...(parsed.data.managerRequired !== undefined &&
        parsed.data.managerRequired !== before.managerRequired
          ? {
              managerRequired: {
                from: before.managerRequired,
                to: parsed.data.managerRequired,
              },
            }
          : {}),
        ...(Object.keys(changedPermissions).length > 0
          ? { changedPermissions }
          : {}),
      },
    }
  ).catch(() => {});

  return NextResponse.json({
    managerRequired: updated.managerRequired,
    permissions: updated.permissionsJson,
  });
}
