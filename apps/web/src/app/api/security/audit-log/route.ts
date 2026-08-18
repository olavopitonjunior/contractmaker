import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, PermissionDeniedError, MembershipRequiredError } from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { auditQuerySchema, buildAuditWhere, impersonatedByFromMetadata } from "@/lib/security/audit-query";

/**
 * GET /api/security/audit-log — log paginado com filtros (1f: + busca livre `q`,
 * `resourceType` e `impersonatedBy`).
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
  const q = parsed.data;
  const where = buildAuditWhere(ctx.orgId, q);

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: q.offset,
      take: q.limit,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  return NextResponse.json({
    total,
    offset: q.offset,
    limit: q.limit,
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      result: r.result,
      resource: r.resource,
      resourceType: r.resourceType,
      metadata: r.metadata,
      impersonatedBy: impersonatedByFromMetadata(r.metadata),
      ipAddress: r.ipAddress,
      userAgent: r.userAgent?.slice(0, 120) ?? null,
      createdAt: r.createdAt,
      user: r.user
        ? { id: r.user.id, name: r.user.name, email: r.user.email }
        : null,
    })),
  });
}
