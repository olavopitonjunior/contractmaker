import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { DIMOB_LAYOUT_VERSION } from "@/lib/dimob/layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return { error: authResult.response } as const;
  const { ctx } = authResult;
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_SETTINGS_EDIT,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return { error: NextResponse.json({ error: err.code }, { status: err.status }) } as const;
    }
    throw err;
  }
  return { ctx } as const;
}

/** POST — marca o leiaute atual como validado no PGD para a org. */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  await prisma.organization.update({
    where: { id: g.ctx.orgId },
    data: { dimobLayoutValidatedVersion: DIMOB_LAYOUT_VERSION },
  });
  await audit(extractAuditContextFromRequest(req, g.ctx.orgId, g.ctx.userId), {
    action: "FISCAL_SETTINGS_UPDATE",
    result: "SUCCESS",
    resource: g.ctx.orgId,
    resourceType: "Organization",
    metadata: { dimobLayoutValidated: DIMOB_LAYOUT_VERSION },
  });
  return NextResponse.json({ layoutValidated: true, version: DIMOB_LAYOUT_VERSION });
}

/** DELETE — remove o selo (volta a "provisório"). */
export async function DELETE(req: NextRequest) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  await prisma.organization.update({
    where: { id: g.ctx.orgId },
    data: { dimobLayoutValidatedVersion: null },
  });
  return NextResponse.json({ layoutValidated: false });
}
