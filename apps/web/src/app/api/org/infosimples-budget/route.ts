import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";
import { getUserOrg } from "@/lib/auth/auth";
import { monthlyBudgetCents, monthlySpendWhere } from "@/lib/certidoes/budget";

/**
 * GET /api/org/infosimples-budget
 *
 * Saldo Infosimples do mês corrente para a org do usuário autenticado.
 * Skill Newton: `check_certidoes_budget` (PRD §5.8).
 *
 * Cálculo:
 *   - spentCents = SUM(CertidaoJob.costCents WHERE orgId = ? AND createdAt no mês corrente)
 *   - budgetCents = INFOSIMPLES_MONTHLY_BUDGET_CENTS (env, default R$ 50000 = 5.000.000 centavos)
 *   - remainingCents = budgetCents - spentCents
 *
 * Response:
 *   {
 *     orgId,
 *     month: "YYYY-MM",
 *     budgetCents,
 *     spentCents,
 *     remainingCents,
 *     pct,                  // 0.0 - 1.0+
 *     ok,                   // true se pct < 1.0
 *     warningPct: 0.8,      // threshold de warning
 *     spentByEndpoint: { [endpoint]: cents }
 *   }
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
      // Mesma contagem que bloqueia o disparo (lib/certidoes/budget.ts):
      // jobs de deal da org + jobs sem deal. Só conta o que custou.
      ...monthlySpendWhere(org.id, "infosimples", monthStart),
      createdAt: { gte: monthStart, lt: monthEnd },
      costCents: { not: null },
    },
    select: { costCents: true, endpoint: true },
  });

  const spentCents = jobs.reduce((acc, j) => acc + (j.costCents ?? 0), 0);
  const spentByEndpoint: Record<string, number> = {};
  for (const j of jobs) {
    spentByEndpoint[j.endpoint] =
      (spentByEndpoint[j.endpoint] ?? 0) + (j.costCents ?? 0);
  }

  // Era `?? "5000000"` (R$ 50.000) enquanto o executor bloqueava em R$ 200:
  // o dashboard e o Newton mostravam um teto 250× maior que o real.
  const budgetCents = monthlyBudgetCents("infosimples");
  const remainingCents = budgetCents - spentCents;
  const pct = budgetCents > 0 ? spentCents / budgetCents : 0;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return NextResponse.json({
    orgId: org.id,
    month,
    budgetCents,
    spentCents,
    remainingCents,
    pct,
    ok: pct < 1,
    warningPct: 0.8,
    spentByEndpoint,
  });
}
