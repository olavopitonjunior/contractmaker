import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { parseRangeFromSearch, InvalidRangeError } from "@/lib/admin/metrics/range";
import { countByKey, bucketByDay } from "@/lib/admin/metrics/aggregate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/orgs/[orgId]/metrics?from&to
 *
 * Deep-dive de um tenant: seções por domínio (membros, vendas, locação,
 * contratos, conhecimento, integrações, IA, storage, auditoria). Gate: support+.
 * Lazy — só roda quando o admin abre o detalhe, então pode fazer joins pesados
 * (são escopados a UMA org). Custos multi-moeda permanecem separados.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
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

  const { orgId } = params;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      subdomain: true,
      createdAt: true,
      suspendedAt: true,
      legalName: true,
      cnpj: true,
      creci: true,
    },
  });
  if (!org) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
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
  const inRange = { gte: range.from, lte: range.to };
  const byOrg = { orgId };
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Deal/Contract precisam de join — resolve os pipelineIds da org uma vez.
  const pipelines = await prisma.pipeline.findMany({
    where: { orgId },
    select: { id: true, kind: true },
  });
  const pipelineIds = pipelines.map((p) => p.id);
  const dealWhere = { pipelineId: { in: pipelineIds } };

  const [
    membersByRole,
    activeMembers,
    modules,
    formsByStatus,
    leadsByStatus,
    dealStages,
    dealAgg,
    contractByStatus,
    contractByKind,
    templatesCount,
    kbByCategory,
    clauseProposalsByStatus,
    templateSuggestionsByStatus,
    envByStatus,
    envAgg,
    asaasAccountsByStatus,
    chargesByStatus,
    chargeAgg,
    transfersByStatus,
    transferAgg,
    certByStatus,
    certByProvider,
    propsByStatus,
    leasesByStatus,
    rentByStatus,
    aiRows,
    auditByAction,
    auditByResult,
    recentAudit,
    dealStorage,
    formStorage,
    chatStorage,
    exportStorage,
  ] = await Promise.all([
    prisma.orgMembership.groupBy({ by: ["role"], where: byOrg, _count: { _all: true } }),
    prisma.orgMembership.count({ where: { orgId, lastActiveAt: { gte: thirtyDaysAgo } } }),
    prisma.orgModule.findMany({ where: byOrg, select: { module: true, enabled: true, featureFlags: true } }),
    prisma.salesForm.groupBy({ by: ["status"], where: byOrg, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["status"], where: byOrg, _count: { _all: true } }),
    pipelineIds.length
      ? prisma.deal.groupBy({ by: ["stageId"], where: dealWhere, _count: { _all: true }, _sum: { value: true } })
      : Promise.resolve([] as never[]),
    pipelineIds.length
      ? prisma.deal.aggregate({ where: dealWhere, _count: { _all: true }, _sum: { value: true } })
      : Promise.resolve({ _count: { _all: 0 }, _sum: { value: 0 } } as never),
    pipelineIds.length
      ? prisma.contract.groupBy({ by: ["status"], where: { deal: dealWhere }, _count: { _all: true } })
      : Promise.resolve([] as never[]),
    pipelineIds.length
      ? prisma.contract.groupBy({ by: ["kind"], where: { deal: dealWhere }, _count: { _all: true } })
      : Promise.resolve([] as never[]),
    prisma.contractTemplate.count({ where: byOrg }),
    prisma.knowledgeItem.groupBy({ by: ["category"], where: byOrg, _count: { _all: true } }),
    prisma.clauseProposal.groupBy({ by: ["status"], where: byOrg, _count: { _all: true } }),
    prisma.templateSuggestion.groupBy({ by: ["status"], where: byOrg, _count: { _all: true } }),
    prisma.envelope.groupBy({ by: ["status"], where: byOrg, _count: { _all: true } }),
    prisma.envelope.aggregate({ where: { orgId, createdAt: inRange }, _sum: { costCents: true }, _count: { _all: true } }),
    prisma.asaasAccount.groupBy({ by: ["status"], where: byOrg, _count: { _all: true } }),
    prisma.commissionCharge.groupBy({ by: ["status"], where: byOrg, _count: { _all: true }, _sum: { value: true } }),
    prisma.commissionCharge.aggregate({ where: { orgId, createdAt: inRange }, _sum: { value: true }, _count: { _all: true } }),
    prisma.asaasTransfer.groupBy({ by: ["status"], where: byOrg, _count: { _all: true }, _sum: { value: true } }),
    prisma.asaasTransfer.aggregate({ where: { orgId, createdAt: inRange }, _sum: { value: true }, _count: { _all: true } }),
    prisma.certidaoJob.groupBy({ by: ["status"], where: byOrg, _count: { _all: true } }),
    prisma.certidaoJob.groupBy({ by: ["provider"], where: { orgId, createdAt: inRange }, _count: { _all: true }, _sum: { costCents: true } }),
    prisma.property.groupBy({ by: ["status"], where: byOrg, _count: { _all: true } }),
    prisma.leaseContract.groupBy({ by: ["status"], where: byOrg, _count: { _all: true }, _sum: { valorAluguel: true } }),
    prisma.rentCharge.groupBy({ by: ["status"], where: byOrg, _count: { _all: true }, _sum: { valorBase: true } }),
    prisma.aIUsage.findMany({
      where: { orgId, createdAt: inRange },
      select: { provider: true, operation: true, estimatedCostUsd: true, totalTokens: true, latencyMs: true, success: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.auditLog.groupBy({ by: ["action"], where: { orgId, createdAt: inRange }, _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ["result"], where: { orgId, createdAt: inRange }, _count: { _all: true } }),
    prisma.auditLog.findMany({
      where: { orgId, createdAt: inRange },
      select: { id: true, action: true, result: true, resourceType: true, userId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.dealAttachment.aggregate({ where: { deal: { pipeline: { orgId } } }, _sum: { byteSize: true }, _count: { _all: true } }),
    prisma.formAttachment.aggregate({ where: { form: { orgId } }, _sum: { byteSize: true }, _count: { _all: true } }),
    prisma.chatAttachment.aggregate({ where: { session: { contract: { deal: dealWhere } } }, _sum: { byteSize: true }, _count: { _all: true } }),
    prisma.export.aggregate({ where: { contract: { deal: dealWhere } }, _sum: { fileSize: true }, _count: { _all: true } }),
  ]);

  // ---- IA (in-memory, escopado à org) ----
  const aiTotals = {
    costUsd: round4(aiRows.reduce((a, r) => a + Number(r.estimatedCostUsd ?? 0), 0)),
    calls: aiRows.length,
    tokens: aiRows.reduce((a, r) => a + r.totalTokens, 0),
    failures: aiRows.filter((r) => !r.success).length,
    avgLatencyMs: aiRows.length
      ? Math.round(aiRows.reduce((a, r) => a + r.latencyMs, 0) / aiRows.length)
      : 0,
  };
  const aiByDay = bucketByDay(
    aiRows,
    (r) => r.createdAt,
    (r) => Number(r.estimatedCostUsd ?? 0)
  );
  const aiByOperation = aggregateAi(aiRows, (r) => r.operation);
  const aiByProvider = aggregateAi(aiRows, (r) => r.provider);

  // ---- Stage labels p/ o funil de vendas ----
  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: { in: pipelineIds } },
    select: { id: true, name: true, position: true, pipeline: { select: { kind: true } } },
    orderBy: { position: "asc" },
  });
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const dealsByStage = (dealStages as Array<{ stageId: string; _count: { _all: number }; _sum: { value: number | null } }>)
    .map((d) => ({
      stageId: d.stageId,
      stage: stageById.get(d.stageId)?.name ?? "—",
      kind: stageById.get(d.stageId)?.pipeline.kind ?? "venda",
      position: stageById.get(d.stageId)?.position ?? 999,
      count: d._count._all,
      valueBRL: round2(Number(d._sum.value ?? 0)),
    }))
    .sort((a, b) => a.position - b.position);

  const storageBytes =
    (dealStorage._sum.byteSize ?? 0) +
    (formStorage._sum.byteSize ?? 0) +
    (chatStorage._sum.byteSize ?? 0) +
    (exportStorage._sum.fileSize ?? 0);

  return NextResponse.json({
    org: {
      id: org.id,
      name: org.name,
      subdomain: org.subdomain,
      createdAt: org.createdAt.toISOString(),
      suspended: org.suspendedAt != null,
      legalName: org.legalName,
      cnpj: org.cnpj,
      creci: org.creci,
    },
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    members: {
      byRole: countByKey(membersByRole as never, "role"),
      activeLast30d: activeMembers,
      modules: modules.map((m) => ({ module: m.module, enabled: m.enabled, featureFlags: m.featureFlags })),
    },
    sales: {
      formsByStatus: countByKey(formsByStatus as never, "status"),
      leadsByStatus: countByKey(leadsByStatus as never, "status"),
      deals: {
        total: (dealAgg as { _count: { _all: number } })._count._all,
        valueBRL: round2(Number((dealAgg as { _sum: { value: number | null } })._sum.value ?? 0)),
        byStage: dealsByStage.filter((d) => d.kind === "venda"),
      },
    },
    locacao: {
      propertiesByStatus: countByKey(propsByStatus as never, "status"),
      leasesByStatus: groupCountSum(leasesByStatus as never, "status", "valorAluguel"),
      rentChargesByStatus: groupCountSum(rentByStatus as never, "status", "valorBase"),
      dealsByStage: dealsByStage.filter((d) => d.kind === "locacao"),
    },
    contracts: {
      byStatus: countByKey(contractByStatus as never, "status"),
      byKind: countByKey(contractByKind as never, "kind"),
      templates: templatesCount,
    },
    knowledge: {
      byCategory: countByKey(kbByCategory as never, "category"),
      clauseProposalsByStatus: countByKey(clauseProposalsByStatus as never, "status"),
      templateSuggestionsByStatus: countByKey(templateSuggestionsByStatus as never, "status"),
    },
    integrations: {
      clicksign: {
        byStatus: countByKey(envByStatus as never, "status"),
        costBRLInRange: centsToBRL(envAgg._sum.costCents ?? 0),
        envelopesInRange: envAgg._count._all,
      },
      asaas: {
        accountsByStatus: countByKey(asaasAccountsByStatus as never, "status"),
        chargesByStatus: groupCountSum(chargesByStatus as never, "status", "value"),
        volumeBRLInRange: round2(Number(chargeAgg._sum.value ?? 0)),
        chargesInRange: chargeAgg._count._all,
        transfersByStatus: groupCountSum(transfersByStatus as never, "status", "value"),
        transferVolumeBRLInRange: round2(Number(transferAgg._sum.value ?? 0)),
      },
      certidoes: {
        byStatus: countByKey(certByStatus as never, "status"),
        byProvider: (certByProvider as Array<{ provider: string; _count: { _all: number }; _sum: { costCents: number | null } }>).map((p) => ({
          provider: p.provider,
          count: p._count._all,
          costBRL: centsToBRL(p._sum.costCents ?? 0),
        })),
      },
    },
    ai: {
      totals: aiTotals,
      byDay: aiByDay,
      byOperation: aiByOperation,
      byProvider: aiByProvider,
    },
    storage: {
      totalBytes: storageBytes,
      deal: { bytes: dealStorage._sum.byteSize ?? 0, count: dealStorage._count._all },
      form: { bytes: formStorage._sum.byteSize ?? 0, count: formStorage._count._all },
      chat: { bytes: chatStorage._sum.byteSize ?? 0, count: chatStorage._count._all },
      export: { bytes: exportStorage._sum.fileSize ?? 0, count: exportStorage._count._all },
    },
    audit: {
      byAction: countByKey(auditByAction as never, "action"),
      byResult: countByKey(auditByResult as never, "result"),
      recent: recentAudit.map((a) => ({
        id: a.id,
        action: a.action,
        result: a.result,
        resourceType: a.resourceType,
        userId: a.userId,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  });
}

function aggregateAi<T extends { estimatedCostUsd: unknown; totalTokens: number }>(
  rows: T[],
  keyOf: (r: T) => string
) {
  const m = new Map<string, { key: string; costUsd: number; calls: number; tokens: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    const e = m.get(key) ?? { key, costUsd: 0, calls: 0, tokens: 0 };
    e.costUsd += Number(r.estimatedCostUsd ?? 0);
    e.calls += 1;
    e.tokens += r.totalTokens;
    m.set(key, e);
  }
  return Array.from(m.values())
    .map((e) => ({ ...e, costUsd: round4(e.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function groupCountSum<T extends Record<string, unknown>>(
  rows: Array<T & { _count?: { _all?: number }; _sum?: Record<string, number | null> }>,
  key: keyof T,
  sumField: string
): Record<string, { count: number; sumBRL: number }> {
  const out: Record<string, { count: number; sumBRL: number }> = {};
  for (const r of rows) {
    const k = String(r[key] ?? "—");
    out[k] = {
      count: r._count?._all ?? 0,
      sumBRL: round2(Number(r._sum?.[sumField] ?? 0)),
    };
  }
  return out;
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
