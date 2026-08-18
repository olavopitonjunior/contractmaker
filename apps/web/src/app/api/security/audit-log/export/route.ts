import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import {
  auditQuerySchema,
  buildAuditWhere,
  impersonatedByFromMetadata,
} from "@/lib/security/audit-query";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Export síncrono, com cap. Export assíncrono (fila) fica pra depois se a
// contagem crescer — hoje o AuditLog por org cabe folgado em 5000 linhas.
const MAX_ROWS = 5000;

// Separador `;` + BOM UTF-8: mesma convenção do export do relatório de pipeline
// (PR 3.7), pra o Excel pt-BR abrir sem quebrar acento nem juntar colunas.
const SEP = ";";
const BOM = "﻿";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/security/audit-log/export — exporta o log filtrado como CSV.
 * Mesmos filtros do GET paginado (via auditQuerySchema/buildAuditWhere).
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
    "userEmail",
    "impersonatedBy",
    "ipAddress",
  ];
  const lines = [header.join(SEP)];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.action,
        r.result,
        r.resourceType,
        r.resource,
        r.user?.email,
        impersonatedByFromMetadata(r.metadata),
        r.ipAddress,
      ]
        .map(csvCell)
        .join(SEP)
    );
  }
  const csv = BOM + lines.join("\r\n");

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "AUDIT_LOG_EXPORTED",
    result: "SUCCESS",
    resourceType: "AuditLog",
    metadata: {
      rows: rows.length,
      capped: rows.length >= MAX_ROWS,
      filters: parsed.data,
    },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
