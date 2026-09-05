import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getMonthlySpend, observedPriceByEndpoint } from "@/lib/certidoes/executor";
import type { ExtractionPlan } from "@/lib/certidoes/types";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";
import { planProposalCertidoes } from "@/lib/certidoes/proposal-dispatch";
import {
  listAllForPicker,
  listCoveredUfs,
  listCoveredCategories,
  CATEGORY_LABELS,
} from "@/lib/certidoes/catalog";

export const runtime = "nodejs";

/**
 * GET /api/proposals/:id/certidoes/plan[?full=1][&extraRegions=UF|cidade;…]
 *
 * Mesmo contrato do plano do Deal (o `ExtractCertidoesDialog` é o mesmo):
 * plano automático + gasto do mês; com `full=1`, catálogo, plano expandido e
 * saúde da API. Sem diligenciados e sem `formToken` (a proposta não tem
 * formulário público para completar dados — o editor de partes faz isso).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: false });
  if ("fail" in r) return r.fail;
  const { scope } = r;

  const { searchParams } = new URL(req.url);
  const full = searchParams.get("full") === "1";
  const extraRegions = (searchParams.get("extraRegions") || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [uf, cidade] = pair.split("|");
      return { uf: (uf || "").trim(), cidade: (cidade || "").trim() || undefined };
    })
    .filter((x) => x.uf);

  const observed = await observedPriceByEndpoint(scope.orgId);
  const applyObservedPrices = (p: ExtractionPlan): ExtractionPlan => {
    let total = 0;
    for (const j of p.jobs) {
      j.costCents = observed[j.endpoint] ?? j.costCents;
      total += j.costCents;
    }
    p.totalCostCents = total;
    return p;
  };

  const base = { dataJson: scope.dataJson, esteira: scope.esteira, userEmail: null, extraRegions };
  const plan = applyObservedPrices(await planProposalCertidoes({ ...base, expandAll: false }));
  const spend = await getMonthlySpend(scope.orgId);

  if (!full) {
    return NextResponse.json({ plan, spend, diligenciados: [], formToken: null });
  }

  const expandedPlan = applyObservedPrices(await planProposalCertidoes({ ...base, expandAll: true }));
  const catalog = listAllForPicker();

  const last24 = new Date(Date.now() - 24 * 60 * 60_000);
  const recentJobs = await prisma.certidaoJob.findMany({
    where: { orgId: scope.orgId, createdAt: { gte: last24 } },
    select: { endpoint: true, resultCode: true, status: true },
  });
  const agg: Record<string, { total: number; bad: number }> = {};
  for (const j of recentJobs) {
    const a = (agg[j.endpoint] ??= { total: 0, bad: 0 });
    a.total++;
    const code = j.resultCode ?? 0;
    const bad =
      [615, 665, 666, 667, 603, 604].includes(code) ||
      code >= 500 ||
      j.status === "portal_unavailable" ||
      j.status === "rate_limited";
    if (bad) a.bad++;
  }
  const apiHealth: Record<string, "ok" | "degraded" | "down"> = {};
  for (const [ep, a] of Object.entries(agg)) {
    const rate = a.total > 0 ? a.bad / a.total : 0;
    apiHealth[ep] = rate >= 0.5 ? "down" : rate > 0 ? "degraded" : "ok";
  }

  return NextResponse.json({
    plan,
    expandedPlan,
    spend,
    formToken: null,
    diligenciados: [],
    catalog,
    apiHealth,
    catalogMeta: {
      ufs: listCoveredUfs(),
      categories: listCoveredCategories().map((c) => ({ id: c, label: CATEGORY_LABELS[c] })),
    },
  });
}
