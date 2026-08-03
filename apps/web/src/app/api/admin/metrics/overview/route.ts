import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { parseRangeFromSearch, InvalidRangeError } from "@/lib/admin/metrics/range";
import { countByOrg, sumByOrg, PLATFORM_BUCKET } from "@/lib/admin/metrics/aggregate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/metrics/overview?from&to
 *
 * Visão system-wide do painel super-admin: totais agregados + uma linha de
 * resumo por tenant. Gate: support+ (leitura). Janela default 30d.
 *
 * Performance: O(modelos) queries (um groupBy(['orgId']) por modelo com orgId
 * direto), nunca O(tenants). Deal precisa de join — resolvemos o mapa
 * pipelineId→orgId uma vez. Trabalho pesado (byDay/topN) fica no deep-dive.
 * Custos multi-moeda ficam SEPARADOS (USD de IA, BRL de ClickSign/Asaas/Certidões).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requirePlatformRole(session.user.id, "support");
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return NextResponse.json(
        { error: err.code, requiredRole: err.requiredRole },
        { status: err.status }
      );
    }
    throw err;
  }

  let range;
  try {
    range = parseRangeFromSearch(new URL(req.url).searchParams);
  } catch (err) {
    if (err instanceof InvalidRangeError) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    throw err;
  }
  const createdInRange = { createdAt: { gte: range.from, lte: range.to } };

  const [
    orgs,
    orgModules,
    pipelines,
    aiByOrg,
    envByOrg,
    chargeByOrg,
    certByOrg,
    apiByOrg,
    leasesActiveByOrg,
    asaasAccountsByOrg,
  ] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        subdomain: true,
        createdAt: true,
        suspendedAt: true,
        _count: { select: { members: true } },
      },
    }),
    prisma.orgModule.findMany({ select: { orgId: true, module: true, enabled: true } }),
    prisma.pipeline.findMany({ select: { id: true, orgId: true, kind: true } }),
    prisma.aIUsage.groupBy({
      by: ["orgId"],
      where: createdInRange,
      _sum: { estimatedCostUsd: true, totalTokens: true },
      _count: { _all: true },
    }),
    prisma.envelope.groupBy({
      by: ["orgId"],
      where: createdInRange,
      _sum: { costCents: true },
      _count: { _all: true },
    }),
    prisma.commissionCharge.groupBy({
      by: ["orgId"],
      where: createdInRange,
      _sum: { value: true },
      _count: { _all: true },
    }),
    prisma.certidaoJob.groupBy({
      by: ["orgId"],
      where: createdInRange,
      _sum: { costCents: true },
      _count: { _all: true },
    }),
    prisma.apiUsage.groupBy({
      by: ["orgId"],
      where: createdInRange,
      _count: { _all: true },
    }),
    prisma.leaseContract.groupBy({
      by: ["orgId"],
      where: { status: "ativo" },
      _count: { _all: true },
    }),
    prisma.asaasAccount.groupBy({
      by: ["orgId"],
      _count: { _all: true },
    }),
  ]);

  // Deal precisa de join via pipeline.orgId — resolve o mapa uma vez. O
  // `kind` do pipeline vem junto pra separar venda × locação sem query extra.
  const pipelineOrg = new Map(pipelines.map((p) => [p.id, p.orgId]));
  const pipelineKind = new Map(pipelines.map((p) => [p.id, p.kind]));
  const dealGroups = await prisma.deal.groupBy({
    by: ["pipelineId"],
    where: createdInRange,
    _count: { _all: true },
    _sum: { value: true },
  });
  const dealsByOrg = new Map<string, number>();
  const dealsLocacaoByOrg = new Map<string, number>();
  const dealValueByOrg = new Map<string, number>();
  for (const d of dealGroups) {
    const orgId = pipelineOrg.get(d.pipelineId);
    if (!orgId) continue;
    dealsByOrg.set(orgId, (dealsByOrg.get(orgId) ?? 0) + d._count._all);
    if (pipelineKind.get(d.pipelineId) === "locacao") {
      dealsLocacaoByOrg.set(
        orgId,
        (dealsLocacaoByOrg.get(orgId) ?? 0) + d._count._all
      );
    }
    dealValueByOrg.set(
      orgId,
      (dealValueByOrg.get(orgId) ?? 0) + Number(d._sum.value ?? 0)
    );
  }

  // Indexa por orgId.
  const aiCost = sumByOrg(aiByOrg, "estimatedCostUsd");
  const aiTokens = sumByOrg(aiByOrg, "totalTokens");
  const aiCalls = countByOrg(aiByOrg);
  const envCost = sumByOrg(envByOrg, "costCents");
  const envCount = countByOrg(envByOrg);
  const chargeVolume = sumByOrg(chargeByOrg, "value");
  const chargeCount = countByOrg(chargeByOrg);
  const certCost = sumByOrg(certByOrg, "costCents");
  const certCount = countByOrg(certByOrg);
  const apiCalls = countByOrg(apiByOrg);
  const activeLeases = countByOrg(leasesActiveByOrg);
  const asaasAccounts = countByOrg(asaasAccountsByOrg);

  const modulesByOrg = new Map<string, string[]>();
  for (const m of orgModules) {
    if (!m.enabled) continue;
    const arr = modulesByOrg.get(m.orgId) ?? [];
    arr.push(m.module);
    modulesByOrg.set(m.orgId, arr);
  }

  const perTenant = orgs.map((o) => ({
    orgId: o.id,
    name: o.name,
    subdomain: o.subdomain,
    createdAt: o.createdAt.toISOString(),
    suspended: o.suspendedAt != null,
    modules: modulesByOrg.get(o.id) ?? [],
    members: o._count.members,
    deals: dealsByOrg.get(o.id) ?? 0,
    dealsLocacao: dealsLocacaoByOrg.get(o.id) ?? 0,
    dealsValueBRL: round2(dealValueByOrg.get(o.id) ?? 0),
    activeLeases: activeLeases.get(o.id) ?? 0,
    asaasAccounts: asaasAccounts.get(o.id) ?? 0,
    aiCostUsd: round4(aiCost.get(o.id) ?? 0),
    aiCalls: aiCalls.get(o.id) ?? 0,
    aiTokens: aiTokens.get(o.id) ?? 0,
    clicksignCostBRL: centsToBRL(envCost.get(o.id) ?? 0),
    envelopes: envCount.get(o.id) ?? 0,
    asaasVolumeBRL: round2(chargeVolume.get(o.id) ?? 0),
    charges: chargeCount.get(o.id) ?? 0,
    certidoesCostBRL: centsToBRL(certCost.get(o.id) ?? 0),
    certidoes: certCount.get(o.id) ?? 0,
    apiCalls: apiCalls.get(o.id) ?? 0,
  }));

  const totals = {
    tenants: orgs.length,
    suspended: orgs.filter((o) => o.suspendedAt != null).length,
    members: sum(perTenant, (t) => t.members),
    deals: sum(perTenant, (t) => t.deals),
    activeLeases: sum(perTenant, (t) => t.activeLeases),
    aiCostUsd: round4(sum(perTenant, (t) => t.aiCostUsd)),
    aiTokens: sum(perTenant, (t) => t.aiTokens),
    aiCalls: sum(perTenant, (t) => t.aiCalls),
    clicksignCostBRL: round2(sum(perTenant, (t) => t.clicksignCostBRL)),
    envelopes: sum(perTenant, (t) => t.envelopes),
    asaasVolumeBRL: round2(sum(perTenant, (t) => t.asaasVolumeBRL)),
    charges: sum(perTenant, (t) => t.charges),
    certidoesCostBRL: round2(sum(perTenant, (t) => t.certidoesCostBRL)),
    certidoes: sum(perTenant, (t) => t.certidoes),
    apiCalls: sum(perTenant, (t) => t.apiCalls),
  };

  // Custo SEM tenant (orgId IS NULL — embedding da base universal etc.). Não
  // entra em perTenant nem em totals: plataforma não é tenant, e somá-la a um
  // total "dos tenants" esconderia de novo o que a linha existe pra mostrar.
  const platform = {
    aiCostUsd: round4(aiCost.get(PLATFORM_BUCKET) ?? 0),
    aiCalls: aiCalls.get(PLATFORM_BUCKET) ?? 0,
    aiTokens: aiTokens.get(PLATFORM_BUCKET) ?? 0,
  };

  return NextResponse.json({
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    totals,
    platform,
    perTenant,
  });
}

function sum<T>(rows: T[], of: (r: T) => number): number {
  return rows.reduce((acc, r) => acc + of(r), 0);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function centsToBRL(cents: number): number {
  return Math.round(cents) / 100;
}
