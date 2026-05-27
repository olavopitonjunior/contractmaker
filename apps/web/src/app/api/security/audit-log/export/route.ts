import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { auditQuerySchema, buildAuditWhere } from "@/lib/security/audit-query";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 1000;

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/security/audit-log/export — exporta o log filtrado como CSV.
 * Síncrono, cap MAX_ROWS (export assíncrono via Inngest fica pra Fase 2). Gated.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.AUDIT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Query inválida" }, { status: 400 });
  }
  const where = buildAuditWhere(ctx.orgId, parsed.data);

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    include: { user: { select: { email: true } } },
  });

  const header = [
    "createdAt",
    "action",
    "result",
    "resourceType",
    "resource",
    "entityId",
    "userEmail",
    "impersonatedBy",
    "ipAddress",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.action,
        r.result,
        r.resourceType,
        r.resource,
        r.entityId,
        r.user?.email,
        r.impersonatedBy,
        r.ipAddress,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  const csv = lines.join("\n");

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "AUDIT_LOG_EXPORTED",
    result: "SUCCESS",
    resourceType: "AuditLog",
    metadata: { rows: rows.length, capped: rows.length >= MAX_ROWS, filters: parsed.data },
    impersonatedBy: ctx.impersonatedBy ?? undefined,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
