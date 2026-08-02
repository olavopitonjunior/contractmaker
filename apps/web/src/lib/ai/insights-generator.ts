import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { recordAIUsage } from "@/lib/ai/usage";
import { assertAgentBudget } from "./budget";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import { composeSystemPrompt } from "@/lib/ai/agents/prompt-blocks";
import {
  cacheKey,
  getCached,
  hashSnapshot,
  setCached,
  type AIInsight,
} from "@/lib/ai/insights-cache";

const HAIKU = "claude-haiku-4-5-20251001";

export type InsightContext = "dashboard" | "contract" | "property" | "cashflow";

interface BuildSnapshotArgs {
  orgId: string;
  contextId?: string;
}

/**
 * Coleta snapshot mínimo dos dados relevantes pra o contexto. Mantemos pequeno
 * (max ~50 itens) pra controlar custo do prompt — insights são observações
 * de alto nível, não análise exaustiva.
 */
async function buildSnapshot(
  context: InsightContext,
  args: BuildSnapshotArgs
): Promise<Record<string, unknown>> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const in60d = new Date(now.getTime() + 60 * 24 * 3600_000);

  if (context === "dashboard") {
    const [
      totalContratos,
      contratosAtivos,
      cobrancasAtrasadas,
      cobrancasMesPagas,
      cobrancasMesPendentes,
      seguros60d,
      garantias60d,
      checklistsPendentes,
      reajustesMes,
      repassesPendentes,
      sleAtrasadas,
    ] = await Promise.all([
      prisma.leaseContract.count({ where: { orgId: args.orgId } }),
      prisma.leaseContract.count({ where: { orgId: args.orgId, status: "ativo" } }),
      prisma.rentCharge.count({ where: { orgId: args.orgId, status: "atrasada" } }),
      prisma.rentCharge.count({
        where: { orgId: args.orgId, status: "paga", paidAt: { gte: startOfMonth } },
      }),
      prisma.rentCharge.count({
        where: { orgId: args.orgId, status: { in: ["pendente", "emitida"] } },
      }),
      prisma.insurancePolicy.count({
        where: {
          orgId: args.orgId,
          status: "ativa",
          vigenciaFim: { lte: in60d, gte: now },
        },
      }),
      prisma.guarantee.count({
        where: {
          orgId: args.orgId,
          status: "ativa",
          leaseContract: { vigenciaFim: { lte: in60d, gte: now } },
        },
      }),
      prisma.checklist.count({
        where: { orgId: args.orgId, status: { in: ["pendente", "aguardando_aprovacao"] } },
      }),
      prisma.leaseContract.count({
        where: {
          orgId: args.orgId,
          status: "ativo",
          dataProximoReajuste: { gte: startOfMonth, lt: startOfNextMonth },
        },
      }),
      prisma.rentCharge.count({
        where: { orgId: args.orgId, status: "paga", repasseTransferId: null },
      }),
      prisma.expense.count({
        where: { orgId: args.orgId, status: "pendente", dueDate: { lt: now } },
      }),
    ]);
    return {
      totalContratos,
      contratosAtivos,
      cobrancasAtrasadas,
      cobrancasMesPagas,
      cobrancasMesPendentes,
      seguros60d,
      garantias60d,
      checklistsPendentes,
      reajustesMes,
      repassesPendentes,
      despesasAtrasadas: sleAtrasadas,
    };
  }

  if (context === "contract" && args.contextId) {
    const lease = await prisma.leaseContract.findFirst({
      where: { id: args.contextId, orgId: args.orgId },
      include: {
        rentCharges: { orderBy: { dueDate: "desc" }, take: 6 },
        guarantee: true,
        insurancePolicies: { where: { status: "ativa" }, take: 3 },
        checklists: { take: 5 },
      },
    });
    if (!lease) return {};
    return {
      valorAluguel: lease.valorAluguel,
      status: lease.status,
      taxaAdminPercent: lease.taxaAdminPercent,
      diaVencimento: lease.diaVencimento,
      vigenciaFim: lease.vigenciaFim,
      dataProximoReajuste: lease.dataProximoReajuste,
      regimeIr: lease.regimeIr,
      repasseGarantido: lease.repasseGarantido,
      cobrancasRecentes: lease.rentCharges.map((c) => ({
        competencia: c.competencia,
        status: c.status,
        valor: c.valorBase + c.encargos,
        atrasou: c.status === "atrasada",
      })),
      garantia: lease.guarantee
        ? {
            tipo: lease.guarantee.tipo,
            status: lease.guarantee.status,
            coberturaMeses: lease.guarantee.coberturaMeses,
          }
        : null,
      apolicesSeguro: lease.insurancePolicies.map((p) => ({
        tipo: p.tipo,
        vigenciaFim: p.vigenciaFim,
        diasAteVencer: Math.floor((p.vigenciaFim.getTime() - now.getTime()) / 86400000),
      })),
      checklistsPendentesCount: lease.checklists.filter((c) => c.status !== "concluido").length,
    };
  }

  if (context === "property" && args.contextId) {
    const property = await prisma.property.findFirst({
      where: { id: args.contextId, orgId: args.orgId },
      include: {
        ownerships: { include: { owner: { select: { nome: true } } } },
        leaseContracts: {
          select: { id: true, status: true, valorAluguel: true, vigenciaFim: true },
          take: 5,
        },
        maintenances: { where: { status: { in: ["solicitada", "em_andamento"] } } },
        insurancePolicies: { where: { status: "ativa" } },
      },
    });
    if (!property) return {};
    return {
      kind: property.kind,
      status: property.status,
      valorAluguelSugerido: property.valorAluguelSugerido,
      proprietarios: property.ownerships.map((o) => ({
        nome: o.owner.nome,
        percentual: o.percentual,
      })),
      contratos: property.leaseContracts,
      manutencoesAbertas: property.maintenances.length,
      seguroVigente: property.insurancePolicies.length > 0,
    };
  }

  if (context === "cashflow") {
    const [previsto, recebido, repassePendente] = await Promise.all([
      prisma.rentCharge.aggregate({
        where: {
          orgId: args.orgId,
          dueDate: { gte: startOfMonth, lt: startOfNextMonth },
        },
        _sum: { valorBase: true, encargos: true },
      }),
      prisma.rentCharge.aggregate({
        where: {
          orgId: args.orgId,
          status: "paga",
          paidAt: { gte: startOfMonth, lt: startOfNextMonth },
        },
        _sum: { valorBase: true, encargos: true },
      }),
      prisma.rentCharge.aggregate({
        where: { orgId: args.orgId, status: "paga", repasseTransferId: null },
        _sum: { valorBase: true, encargos: true },
      }),
    ]);
    return {
      mesPrevisto:
        (previsto._sum.valorBase ?? 0) + (previsto._sum.encargos ?? 0),
      mesRecebido:
        (recebido._sum.valorBase ?? 0) + (recebido._sum.encargos ?? 0),
      repasseAcumuladoNaoFeito:
        (repassePendente._sum.valorBase ?? 0) + (repassePendente._sum.encargos ?? 0),
    };
  }

  return {};
}

export const INSIGHTS_SYSTEM_PROMPT = `Você é assistente de gestor imobiliário no app imobpro.ai. Gere de 1 a 3 observações ACIONÁVEIS sobre o snapshot do contexto.

Regras:
- 1 linha cada (max 120 chars).
- Tom direto, sem floreio. Pt-BR.
- Cada observação tem severity: "info" (neutro), "alert" (algo que merece atenção urgente), ou "suggestion" (oportunidade/melhoria).
- Não fale o óbvio. Só insights que ajudem o gestor a agir.
- Se snapshot está vazio ou tudo está saudável, retorne ARRAY VAZIO [].

Responda APENAS um JSON array de objetos: [{"severity": "alert", "title": "...", "detail": "..."}].`;

export async function generateInsights(args: {
  orgId: string;
  userId: string;
  context: InsightContext;
  contextId?: string;
}): Promise<AIInsight[]> {
  // F3.7 gate: org pode desabilitar global ou por contexto. O toggle global
  // agora é o `enabled` do perfil (kill switch do console); o por-contexto
  // segue no `config`, migrado do AgentConfig.aiInsightsConfig.
  const profile = await resolveAgentProfile("insights", args.orgId);
  if (!profile.enabled) return [];
  const cfg = profile.config as
    | { enabled?: boolean; contexts?: Record<string, boolean> }
    | null
    | undefined;
  if (cfg) {
    if (cfg.enabled === false) return [];
    if (cfg.contexts && cfg.contexts[args.context] === false) return [];
  }

  const snapshot = await buildSnapshot(args.context, {
    orgId: args.orgId,
    contextId: args.contextId,
  });

  const hash = hashSnapshot(snapshot);
  const key = cacheKey(args.context, args.contextId ?? args.orgId, hash);
  const cached = await getCached(key);
  if (cached) return cached;

  if (!process.env.ANTHROPIC_API_KEY) {
    // Sem API key (dev/local): retorna observações minimal heurísticas pra não quebrar UI.
    return heuristicFallback(args.context, snapshot);
  }

  // timeout/maxRetries explícitos: insights não devem pendurar a request (o
  // default do SDK é minutos). Em falha cai no catch → heuristicFallback.
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 15_000,
    maxRetries: 1,
  });
  const startedAt = Date.now();
  try {
    // Teto por agente. Aqui a degradação já existe e é boa: o catch abaixo cai
    // no `heuristicFallback`, então estourar o teto vira insight sem LLM em vez
    // de tela vazia.
    await assertAgentBudget(args.orgId, "insights");
    const resp = await client.messages.create({
      model: profile.model || HAIKU,
      max_tokens: profile.maxTokens ?? 600,
      // Instruções da plataforma/tenant entram como apêndice — sem isto o
      // campo existiria no console sem ninguém ler.
      system: composeSystemPrompt(INSIGHTS_SYSTEM_PROMPT, profile),
      messages: [
        {
          role: "user",
          content: `Contexto: ${args.context}\n\nDados:\n${JSON.stringify(snapshot, null, 2)}\n\nGere insights agora.`,
        },
      ],
    });

    const latencyMs = Date.now() - startedAt;
    recordAIUsage({
      orgId: args.orgId,
      userId: args.userId,
      provider: "anthropic",
      model: profile.model || HAIKU,
      operation: "insights",
      promptTokens: resp.usage.input_tokens,
      completionTokens: resp.usage.output_tokens,
      latencyMs,
      success: true,
    });

    const textBlock = resp.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];
    const insights = parseInsightsResponse(textBlock.text);
    await setCached(key, insights);
    return insights;
  } catch (err) {
    recordAIUsage({
      orgId: args.orgId,
      userId: args.userId,
      provider: "anthropic",
      model: profile.model || HAIKU,
      operation: "insights",
      promptTokens: 0,
      latencyMs: Date.now() - startedAt,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return heuristicFallback(args.context, snapshot);
  }
}

function parseInsightsResponse(text: string): AIInsight[] {
  // Modelo às vezes envolve em ```json ... ```. Strip + parse defensivo.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is { severity: string; title: string; detail?: string } => {
        return (
          typeof p === "object" &&
          p !== null &&
          typeof (p as { title?: unknown }).title === "string"
        );
      })
      .slice(0, 3)
      .map((p) => ({
        severity: (["info", "alert", "suggestion"].includes(p.severity)
          ? p.severity
          : "info") as AIInsight["severity"],
        title: p.title.slice(0, 150),
        detail: p.detail?.slice(0, 200),
      }));
  } catch {
    return [];
  }
}

/**
 * Fallback heurístico quando IA não está disponível (sem API key ou erro).
 * Inspeciona o snapshot e gera observações simples baseadas em regras fixas.
 */
function heuristicFallback(
  context: InsightContext,
  snapshot: Record<string, unknown>
): AIInsight[] {
  const out: AIInsight[] = [];
  if (context === "dashboard") {
    const s = snapshot as Record<string, number>;
    if (s.cobrancasAtrasadas > 0) {
      out.push({
        severity: "alert",
        title: `${s.cobrancasAtrasadas} cobrança(s) atrasadas`,
        detail: "Considere disparar a régua de cobrança via Newton.",
      });
    }
    if (s.seguros60d > 0) {
      out.push({
        severity: "alert",
        title: `${s.seguros60d} seguro(s) vencendo nos próximos 60 dias`,
      });
    }
    if (s.reajustesMes > 0) {
      out.push({
        severity: "suggestion",
        title: `${s.reajustesMes} contrato(s) a reajustar este mês`,
      });
    }
  }
  if (context === "contract") {
    const s = snapshot as {
      cobrancasRecentes?: Array<{ atrasou?: boolean }>;
      apolicesSeguro?: Array<{ diasAteVencer?: number }>;
      checklistsPendentesCount?: number;
    };
    const atrasos = (s.cobrancasRecentes ?? []).filter((c) => c.atrasou).length;
    if (atrasos > 0) {
      out.push({
        severity: "alert",
        title: `${atrasos} cobrança(s) atrasadas nos últimos 6 meses`,
      });
    }
    const seguroVencendo = (s.apolicesSeguro ?? []).find(
      (p) => p.diasAteVencer != null && p.diasAteVencer < 60
    );
    if (seguroVencendo) {
      out.push({
        severity: "alert",
        title: `Apólice vence em ${seguroVencendo.diasAteVencer} dias`,
      });
    }
    if ((s.checklistsPendentesCount ?? 0) > 0) {
      out.push({
        severity: "info",
        title: `${s.checklistsPendentesCount} checklist(s) pendente(s)`,
      });
    }
  }
  return out.slice(0, 3);
}
