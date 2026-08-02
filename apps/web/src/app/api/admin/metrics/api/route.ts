import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { prisma } from "@/lib/db/prisma";
import { parseRangeFromSearch, InvalidRangeError } from "@/lib/admin/metrics/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/metrics/api?from&to
 *
 * Uso de API CROSS-TENANT com as quebras que o overview não dá (lá é uma
 * contagem plana por tenant): via session×bearer, endpoint, token e classe de
 * status. **É por aqui que o MCP aparece**: o sidecar (Newton/Max) fala com a
 * REST por bearer, então cada tool call dele já é uma linha de `ApiUsage` —
 * não há telemetria nova a construir no sidecar, há este groupBy.
 *
 * Token identificado pelo NOME (resolvido de `UserApiToken`) — com poucos
 * tokens isso separa Newton de Max sem precisar da coluna `agentKey` no
 * token, que ficou fora de propósito (migration em zona de colisão com a
 * sessão do Max; ver plano).
 *
 * Latência p50/p95 fica no painel por-org (/settings/api-usage), que carrega
 * as linhas cruas — aqui é agregado e percentil de agregado seria mentira.
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

  const [byVia, byPath, byToken, byOrg, byStatus, orgs] = await Promise.all([
    prisma.apiUsage.groupBy({
      by: ["via"],
      where: inRange,
      _count: { _all: true },
    }),
    prisma.apiUsage.groupBy({
      by: ["path", "via"],
      where: inRange,
      _count: { _all: true },
    }),
    prisma.apiUsage.groupBy({
      by: ["tokenId"],
      where: { ...inRange, via: "bearer" },
      _count: { _all: true },
    }),
    prisma.apiUsage.groupBy({
      by: ["orgId"],
      where: inRange,
      _count: { _all: true },
    }),
    prisma.apiUsage.groupBy({
      by: ["statusCode"],
      where: inRange,
      _count: { _all: true },
    }),
    prisma.organization.findMany({ select: { id: true, name: true } }),
  ]);

  const tokenIds = byToken
    .map((t) => t.tokenId)
    .filter((v): v is string => Boolean(v));
  const tokens = tokenIds.length
    ? await prisma.userApiToken.findMany({
        where: { id: { in: tokenIds } },
        select: { id: true, name: true, scopes: true, revokedAt: true },
      })
    : [];
  const tokenById = new Map(tokens.map((t) => [t.id, t]));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const total = byVia.reduce((acc, v) => acc + v._count._all, 0);
  const erros = byStatus
    .filter((s) => s.statusCode >= 400)
    .reduce((acc, s) => acc + s._count._all, 0);

  return NextResponse.json({
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    totals: {
      calls: total,
      errors: erros,
      errorRate: total > 0 ? Math.round((erros / total) * 1000) / 10 : 0,
    },
    byVia: byVia
      .map((v) => ({ via: v.via, calls: v._count._all }))
      .sort((a, b) => b.calls - a.calls),
    // Top endpoints com a via junto — o mesmo path servido a sessão E a
    // bearer aparece duas vezes de propósito: são consumidores diferentes.
    byPath: byPath
      .map((p) => ({ path: p.path, via: p.via, calls: p._count._all }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 20),
    byToken: byToken
      .map((t) => {
        const tok = t.tokenId ? tokenById.get(t.tokenId) : undefined;
        return {
          tokenId: t.tokenId,
          name: tok?.name ?? "(token apagado)",
          scopes: tok?.scopes ?? [],
          revoked: Boolean(tok?.revokedAt),
          calls: t._count._all,
        };
      })
      .sort((a, b) => b.calls - a.calls),
    byOrg: byOrg
      .map((o) => ({
        orgId: o.orgId,
        name: orgName.get(o.orgId) ?? o.orgId,
        calls: o._count._all,
      }))
      .sort((a, b) => b.calls - a.calls),
    byStatusClass: Object.entries(
      byStatus.reduce<Record<string, number>>((acc, s) => {
        const k = `${Math.floor(s.statusCode / 100)}xx`;
        acc[k] = (acc[k] ?? 0) + s._count._all;
        return acc;
      }, {})
    )
      .map(([statusClass, calls]) => ({ statusClass, calls }))
      .sort((a, b) => a.statusClass.localeCompare(b.statusClass)),
  });
}
