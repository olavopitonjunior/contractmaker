import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { prisma } from "@/lib/db/prisma";
import { parseRangeFromSearch, InvalidRangeError } from "@/lib/admin/metrics/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/metrics/audit?from&to
 *
 * Rollup CROSS-TENANT do AuditLog — não existia: a tabela é imutável, guarda
 * tudo desde sempre (fora da retenção por compliance), e mesmo assim só era
 * legível org a org. As perguntas que este endpoint responde: o que mais
 * acontece na plataforma, e ONDE está falhando (FAILURE/DENIED por org e por
 * ação) — que é o insumo do motor de alerta da fase 2.
 *
 * Volume real: ~40 linhas/dia. Agregação ao vivo, sem rollup table.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  let range;
  try {
    range = parseRangeFromSearch(new URL(req.url).searchParams);
  } catch (err) {
    if (err instanceof InvalidRangeError) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    throw err;
  }
  const inRange = { createdAt: { gte: range.from, lte: range.to } };

  const [byAction, byResult, problemas, orgs] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["action"],
      where: inRange,
      _count: { _all: true },
    }),
    prisma.auditLog.groupBy({
      by: ["result"],
      where: inRange,
      _count: { _all: true },
    }),
    // O recorte que importa: o que NÃO deu certo, por org e ação.
    prisma.auditLog.groupBy({
      by: ["orgId", "action", "result"],
      where: { ...inRange, result: { not: "SUCCESS" } },
      _count: { _all: true },
    }),
    prisma.organization.findMany({ select: { id: true, name: true } }),
  ]);

  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  return NextResponse.json({
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    byResult: byResult
      .map((r) => ({ result: r.result, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    topActions: byAction
      .map((a) => ({ action: a.action, count: a._count._all }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    problems: problemas
      .map((p) => ({
        orgId: p.orgId,
        orgName: p.orgId ? orgName.get(p.orgId) ?? p.orgId : "Plataforma",
        action: p.action,
        result: p.result,
        count: p._count._all,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
  });
}
