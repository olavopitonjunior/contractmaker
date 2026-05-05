import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/with-api";

/**
 * GET /api/me/metrics?since=ISO
 *
 * Métricas agregadas do usuário autenticado: contagens de deals/contratos/
 * cobranças por status, atividade recente. Para Newton: skill `query_my_metrics`.
 *
 * Auth: Bearer (escopo `metrics:r`) OU session.
 *
 * Query:
 *   - since=ISO8601 (opcional) — janela. Default: últimos 30 dias.
 *
 * Response:
 *   {
 *     since, until,
 *     deals:    { total, byStatus: { rascunho, em_andamento, ganho, perdido } },
 *     contracts: { total, byStatus: { rascunho, em_revisao, aprovado, assinado, cancelado } },
 *     charges:  { total, byStatus: { PENDING, RECEIVED, OVERDUE, REFUNDED } }
 *   }
 *
 * Privacy: NÃO inclui valores monetários nem dados nominais — apenas contagens.
 */
export const GET = withApi("GET /api/me/metrics", async (req: NextRequest) => {
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
  const since =
    sinceParam !== null
      ? new Date(sinceParam)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { error: "Bad Request", reason: "since must be ISO 8601" },
      { status: 400 }
    );
  }
  const until = new Date();

  const userId = ident.userId;

  const [dealsRaw, contractsRaw, chargesRaw] = await Promise.all([
    prisma.deal.groupBy({
      by: ["stageId"],
      where: { userId, createdAt: { gte: since, lte: until } },
      _count: { _all: true },
    }),
    prisma.contract.groupBy({
      by: ["status"],
      where: { userId, createdAt: { gte: since, lte: until } },
      _count: { _all: true },
    }),
    prisma.commissionCharge.groupBy({
      by: ["status"],
      // CommissionCharge tem orgId mas não userId direto — filtrar por
      // contratos do usuário. Para simplicidade, agregamos por org do usuário.
      where: {
        contract: { userId },
        createdAt: { gte: since, lte: until },
      },
      _count: { _all: true },
    }),
  ]);

  const dealsByStage: Record<string, number> = {};
  for (const row of dealsRaw) dealsByStage[row.stageId] = row._count._all;

  const contractsByStatus: Record<string, number> = {};
  for (const row of contractsRaw) contractsByStatus[row.status] = row._count._all;

  const chargesByStatus: Record<string, number> = {};
  for (const row of chargesRaw) chargesByStatus[row.status] = row._count._all;

  return NextResponse.json({
    since: since.toISOString(),
    until: until.toISOString(),
    deals: {
      total: Object.values(dealsByStage).reduce((a, b) => a + b, 0),
      byStage: dealsByStage,
    },
    contracts: {
      total: Object.values(contractsByStatus).reduce((a, b) => a + b, 0),
      byStatus: contractsByStatus,
    },
    charges: {
      total: Object.values(chargesByStatus).reduce((a, b) => a + b, 0),
      byStatus: chargesByStatus,
    },
  });
});
