import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/me/activity?limit=N&since=ISO
 *
 * Atividade recente do usuário autenticado — leitura do AuditLog filtrada
 * por userId. Para Newton: skill `get_recent_activity`.
 *
 * Auth: Bearer (escopo `metrics:r`) OU session.
 *
 * Query:
 *   - limit (1-200, default 50)
 *   - since=ISO8601 (opcional)
 *
 * Response: { items: [{ id, action, result, resource, resourceType, metadata, createdAt }], total }
 *
 * Privacy: metadata pode conter identifiers; NÃO contém PII bruto se quem
 * registrou seguiu agents.md §14. Cliente é responsável por não exibir
 * resourceId sem contexto.
 */
export async function GET(req: NextRequest) {
  const ident = await authOrBearer(req);
  if (!ident) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(ident, "metrics:r")) {
    return NextResponse.json(
      { error: "Forbidden", reason: "missing scope metrics:r" },
      { status: 403 }
    );
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10), 1), 200) : 50;
  if (Number.isNaN(limit)) {
    return NextResponse.json(
      { error: "Bad Request", reason: "limit must be integer 1-200" },
      { status: 400 }
    );
  }

  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  if (since !== null && Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { error: "Bad Request", reason: "since must be ISO 8601" },
      { status: 400 }
    );
  }

  const where = {
    userId: ident.userId,
    ...(since ? { createdAt: { gte: since } } : {}),
  };

  const items = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      result: true,
      resource: true,
      resourceType: true,
      metadata: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ items, count: items.length });
}
