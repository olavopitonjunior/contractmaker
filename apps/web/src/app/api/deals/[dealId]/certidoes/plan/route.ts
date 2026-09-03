import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal, diligentedPersonToInput } from "@/lib/certidoes/planner";
import { getMonthlySpend, observedPriceByEndpoint } from "@/lib/certidoes/executor";
import type { ExtractionPlan } from "@/lib/certidoes/types";
import { checkGovBrAuth } from "@/lib/certidoes/govbr-auth";
import { checkOnrAuth } from "@/lib/certidoes/onr-auth";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { certidoesFeatureForKind } from "@/lib/modules/catalog";
import { esteiraForDealKind } from "@/lib/certidoes/target-paths";
import {
  listAllForPicker,
  listCoveredUfs,
  listCoveredCategories,
  CATEGORY_LABELS,
} from "@/lib/certidoes/catalog";

export const runtime = "nodejs";

/**
 * GET /api/deals/:dealId/certidoes/plan
 * GET /api/deals/:dealId/certidoes/plan?full=1
 *
 * Default: returns the auto-plan + current monthly spend. Used by the
 * ExtractCertidoesDialog's initial load to decide what to suggest.
 *
 * With `full=1`: also returns the complete endpoint catalog (for the
 * "+ Adicionar outras" picker) AND the expanded plan (with expandAll=true)
 * so the picker can show which extras are ALREADY buildable for each target
 * without requiring extra client-side logic.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { orgId: true, dataJson: true, token: true } },
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Mesmo gate do POST /certidoes (esta rota não tinha nenhum): a feature do
  // módulo do negócio — `vendas.certidoes` ou `locacao.certidoes`.
  const modulesView = await getOrgModules(org.id);
  if (!isFeatureEnabled(modulesView, certidoesFeatureForKind(deal.kind))) {
    return NextResponse.json({ error: "MODULE_DISABLED" }, { status: 403 });
  }
  const esteira = esteiraForDealKind(deal.kind);

  // Escopo do gerente (GET — plano de extração; sem permission).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
  });
  if (denied) return denied;

  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ||
    (deal.dataJson as Record<string, unknown> | null);

  // F3: load diligenciados so they appear in the plan
  const diligenciadosRaw = await prisma.diligentedPerson.findMany({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "asc" },
  });
  const diligenciados = diligenciadosRaw.map(diligentedPersonToInput);

  const { searchParams } = new URL(req.url);
  const full = searchParams.get("full") === "1";
  const formToken = deal.form?.token ?? null;

  // Locais extras ("+ Adicionar outro local"): `extraRegions=UF|cidade;UF|cidade`.
  const extraRegions = (searchParams.get("extraRegions") || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [uf, cidade] = pair.split("|");
      return { uf: (uf || "").trim(), cidade: (cidade || "").trim() || undefined };
    })
    .filter((r) => r.uf);

  // Pre-flight de auth para refletir no plano quais endpoints gated disparam
  // (CENPROT nacional → GOV.BR; matrícula/pesquisa de bens → ONR). Cacheados.
  const [govbr, onr] = await Promise.all([checkGovBrAuth(), checkOnrAuth()]);

  // Estimativa de custo observada (header.price real por endpoint); fallback no
  // costCents do catálogo. Aplica nos jobs do plano antes de devolver.
  const observed = await observedPriceByEndpoint(org.id);
  const applyObservedPrices = (p: ExtractionPlan): ExtractionPlan => {
    let total = 0;
    for (const j of p.jobs) {
      j.costCents = observed[j.endpoint] ?? j.costCents;
      total += j.costCents;
    }
    p.totalCostCents = total;
    return p;
  };

  const plan = applyObservedPrices(
    planCertidoesForDeal(dealData as any, undefined, diligenciados, {
      govBrActive: govbr.active,
      onrActive: onr.active,
      extraRegions,
      esteira,
    })
  );
  const spend = await getMonthlySpend(org.id);

  if (!full) {
    return NextResponse.json({ plan, spend, diligenciados: diligenciadosRaw, formToken });
  }

  // F1/F2: include the full catalog and the expanded plan so the picker can
  // render the "+ Adicionar outras" affordance with accurate payload data.
  const expandedPlan = applyObservedPrices(
    planCertidoesForDeal(dealData as any, undefined, diligenciados, {
      expandAll: true,
      govBrActive: govbr.active,
      onrActive: onr.active,
      extraRegions,
      esteira,
    })
  );
  const catalog = listAllForPicker();

  // E3 — saúde da API por endpoint (org, últimas 24h): pro dialog avisar se a
  // fonte está instável ANTES de gastar. "bad" = portal pausado/instável (615/
  // 66x), conta/crédito (603/604), 5xx, ou status de portal indisponível.
  const last24 = new Date(Date.now() - 24 * 60 * 60_000);
  const recentJobs = await prisma.certidaoJob.findMany({
    where: { orgId: org.id, createdAt: { gte: last24 } },
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
    formToken,
    diligenciados: diligenciadosRaw,
    catalog,
    apiHealth,
    catalogMeta: {
      ufs: listCoveredUfs(),
      categories: listCoveredCategories().map((c) => ({
        id: c,
        label: CATEGORY_LABELS[c],
      })),
    },
  });
}
