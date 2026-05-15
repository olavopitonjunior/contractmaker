import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";
import { getUserOrg } from "@/lib/auth/auth";

/**
 * GET /api/org/serasa-budget
 *
 * Saldo Serasa Experian do mês corrente para a org do usuário autenticado.
 * Espelho do `/api/org/infosimples-budget`, mas filtra `provider: "serasa"`
 * (isolamento de budget entre provedores).
 *
 * Cálculo:
 *   - spentCents  = SUM(CertidaoJob.costCents WHERE orgId AND provider="serasa"
 *                                              AND createdAt >= firstOfMonth)
 *   - budgetCents = SERASA_MONTHLY_BUDGET_CENTS (env, default R$ 5.000 = 500000)
 *
 * Auth: Bearer (escopo `metrics:r`) OU session.
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

  const org = await getUserOrg(ident.userId);
  if (!org) {
    return NextResponse.json(
      { error: "Forbidden", reason: "user has no active org" },
      { status: 403 }
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const jobs = await prisma.certidaoJob.findMany({
    where: {
      orgId: org.id,
      provider: "serasa",
      createdAt: { gte: monthStart, lt: monthEnd },
      costCents: { not: null },
    },
    select: { costCents: true, endpoint: true, status: true, resultData: true },
  });

  const spentCents = jobs.reduce((acc, j) => acc + (j.costCents ?? 0), 0);
  const spentByEndpoint: Record<string, number> = {};
  for (const j of jobs) {
    spentByEndpoint[j.endpoint] = (spentByEndpoint[j.endpoint] ?? 0) + (j.costCents ?? 0);
  }

  // Hit rate específico do Serasa: restritivos com situacao=com_restricao /
  // total de restritivos. Ajuda a entender o valor da integração ("X% das
  // consultas trouxeram informação acionável").
  const restritivos = jobs.filter((j) => j.endpoint.startsWith("serasa/restritivos-"));
  const hits = restritivos.filter((j) => {
    const r = j.resultData as { situacao?: string } | null;
    return r?.situacao === "com_restricao";
  }).length;
  const hitRatePct = restritivos.length > 0 ? Math.round((hits / restritivos.length) * 100) : 0;

  const budgetCents = parseInt(process.env.SERASA_MONTHLY_BUDGET_CENTS ?? "500000", 10);
  const remainingCents = budgetCents - spentCents;
  const pct = budgetCents > 0 ? spentCents / budgetCents : 0;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return NextResponse.json({
    orgId: org.id,
    provider: "serasa",
    month,
    budgetCents,
    spentCents,
    remainingCents,
    pct,
    ok: pct < 1,
    warningPct: 0.8,
    spentByEndpoint,
    restritivos: {
      total: restritivos.length,
      withRestriction: hits,
      hitRatePct,
    },
  });
}
