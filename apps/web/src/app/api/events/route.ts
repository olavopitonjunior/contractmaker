import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";
import { getUserOrg } from "@/lib/auth/auth";
import { withApi } from "@/lib/api/with-api";

/**
 * GET /api/events?since=ISO&limit=N&actions=CSV
 *
 * Feed de eventos para Newton consumir via polling. Lê AuditLog filtrado
 * pela org do usuário autenticado. Newton chama a cada 60s para detectar
 * eventos relevantes (envelope.signed, charge.received, etc.) e disparar
 * notificações proativas.
 *
 * Conforme PRD §3.2 e roadmap §5.N (decisão #19: polling em vez de webhook).
 *
 * Auth: Bearer (escopo `metrics:r`) OU session.
 *
 * Query:
 *   - since=ISO8601 (obrigatório) — cursor temporal. Newton mantém local.
 *   - limit (1-500, default 100)
 *   - actions=ACTION1,ACTION2 (opcional) — filtra por subset de actions
 *
 * Response:
 *   {
 *     events: [{ id, action, result, resource, resourceType, metadata, createdAt, userId }],
 *     count,
 *     nextSince: ISO  // timestamp do último evento + 1ms (cursor para próxima chamada)
 *   }
 *
 * Privacy: somente eventos da org do usuário autenticado. Outras orgs nunca
 * aparecem. metadata pode conter IDs mas não PII bruto se quem registrou
 * seguiu a convenção (agents.md §14).
 */
export const GET = withApi("GET /api/events", async (req: NextRequest) => {
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

  const sinceParam = req.nextUrl.searchParams.get("since");
  if (!sinceParam) {
    return NextResponse.json(
      { error: "Bad Request", reason: "since query param required (ISO 8601)" },
      { status: 400 }
    );
  }
  const since = new Date(sinceParam);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { error: "Bad Request", reason: "since must be ISO 8601" },
      { status: 400 }
    );
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw
    ? Math.min(Math.max(parseInt(limitRaw, 10), 1), 500)
    : 100;
  if (Number.isNaN(limit)) {
    return NextResponse.json(
      { error: "Bad Request", reason: "limit must be integer 1-500" },
      { status: 400 }
    );
  }

  const actionsRaw = req.nextUrl.searchParams.get("actions");
  const actions = actionsRaw
    ? actionsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const org = await getUserOrg(ident.userId);
  if (!org) {
    return NextResponse.json(
      { error: "Forbidden", reason: "user has no active org" },
      { status: 403 }
    );
  }

  const events = await prisma.auditLog.findMany({
    where: {
      orgId: org.id,
      createdAt: { gt: since },
      ...(actions ? { action: { in: actions } } : {}),
    },
    orderBy: { createdAt: "asc" }, // ordem cronológica para consumo sequencial
    take: limit,
    select: {
      id: true,
      action: true,
      result: true,
      resource: true,
      resourceType: true,
      metadata: true,
      createdAt: true,
      userId: true,
    },
  });

  const lastEvent = events[events.length - 1];
  const nextSince = lastEvent
    ? new Date(lastEvent.createdAt.getTime() + 1).toISOString()
    : since.toISOString();

  return NextResponse.json({
    events,
    count: events.length,
    nextSince,
  });
});
