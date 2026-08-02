import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { prisma } from "@/lib/db/prisma";
import { parseRangeFromSearch, InvalidRangeError } from "@/lib/admin/metrics/range";
import { PLATFORM_BUCKET } from "@/lib/admin/metrics/aggregate";
import {
  AGENT_REGISTRY,
  INFRA_OPERATIONS,
  isAgentKey,
} from "@/lib/ai/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/metrics/ai?from&to
 *
 * Custo de IA CROSS-TENANT — o que o /settings/ai-usage (single-org) e o
 * overview (uma linha por tenant) não respondem: "quanto cada agente/modelo/
 * operação custa no sistema inteiro, incluindo a plataforma?".
 *
 * Um groupBy só, dobrado em memória nas quatro visões. 842 linhas em produção
 * — agregação ao vivo resolve por anos; rollup aqui seria infraestrutura pra
 * um problema que não existe.
 *
 * Atribuição do agente segue o registry: linha com `agentKey` usa o rótulo do
 * catálogo; linha sem agente é dividida entre "Infraestrutura" (operação em
 * INFRA_OPERATIONS — embeddings, classificadores, memória) e "Não atribuído"
 * (histórico anterior à coluna + operações mortas). Sem essa divisão, 26% do
 * gasto vira um bucket genérico que não diz nada.
 */

/** Chaves sintéticas — nenhum agentKey/orgId real colide. */
const INFRA_KEY = "__infra__";
const NONE_KEY = "__none__";

interface Bucket {
  costUsd: number;
  calls: number;
  totalTokens: number;
}

function add(m: Map<string, Bucket>, key: string, row: Bucket) {
  const b = m.get(key) ?? { costUsd: 0, calls: 0, totalTokens: 0 };
  b.costUsd += row.costUsd;
  b.calls += row.calls;
  b.totalTokens += row.totalTokens;
  m.set(key, b);
}

function toRows(
  m: Map<string, Bucket>,
  label: (key: string) => string
): Array<{ key: string; label: string } & Bucket> {
  return [...m.entries()]
    .map(([key, b]) => ({
      key,
      label: label(key),
      costUsd: Math.round(b.costUsd * 10000) / 10000,
      calls: b.calls,
      totalTokens: b.totalTokens,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

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

  // Filtro opcional pra aba Custo da página por agente — mesma resposta,
  // recortada. Chave inválida é 404, não filtro silencioso que devolve tudo.
  const agentKeyParam = new URL(req.url).searchParams.get("agentKey");
  if (agentKeyParam && !isAgentKey(agentKeyParam)) {
    return NextResponse.json({ error: "Agente desconhecido" }, { status: 404 });
  }

  const [groups, orgs] = await Promise.all([
    // A granularidade mais fina que as quatro visões precisam — dobrar em
    // memória evita 4 idas ao banco.
    prisma.aIUsage.groupBy({
      by: ["orgId", "agentKey", "provider", "model", "operation"],
      where: {
        createdAt: { gte: range.from, lte: range.to },
        ...(agentKeyParam ? { agentKey: agentKeyParam } : {}),
      },
      _sum: { estimatedCostUsd: true, totalTokens: true },
      _count: { _all: true },
    }),
    prisma.organization.findMany({ select: { id: true, name: true } }),
  ]);

  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const byAgent = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();
  const byOperation = new Map<string, Bucket>();
  const byOrg = new Map<string, Bucket>();
  const totals: Bucket = { costUsd: 0, calls: 0, totalTokens: 0 };

  for (const gRow of groups) {
    const row: Bucket = {
      costUsd: Number(gRow._sum.estimatedCostUsd ?? 0),
      calls: gRow._count._all,
      totalTokens: gRow._sum.totalTokens ?? 0,
    };
    totals.costUsd += row.costUsd;
    totals.calls += row.calls;
    totals.totalTokens += row.totalTokens;

    const agentBucket = gRow.agentKey
      ? gRow.agentKey
      : INFRA_OPERATIONS.has(gRow.operation)
        ? INFRA_KEY
        : NONE_KEY;
    add(byAgent, agentBucket, row);
    add(byModel, `${gRow.provider}:${gRow.model}`, row);
    add(byOperation, gRow.operation, row);
    add(byOrg, gRow.orgId ?? PLATFORM_BUCKET, row);
  }

  return NextResponse.json({
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    totals: {
      costUsd: Math.round(totals.costUsd * 10000) / 10000,
      calls: totals.calls,
      totalTokens: totals.totalTokens,
    },
    byAgent: toRows(byAgent, (k) =>
      k === INFRA_KEY
        ? "Infraestrutura"
        : k === NONE_KEY
          ? "Não atribuído"
          : isAgentKey(k)
            ? AGENT_REGISTRY[k].label
            : k
    ),
    byModel: toRows(byModel, (k) => k.split(":").slice(1).join(":")),
    byOperation: toRows(byOperation, (k) => k),
    byOrg: toRows(byOrg, (k) =>
      k === PLATFORM_BUCKET ? "Plataforma" : orgName.get(k) ?? k
    ),
  });
}
