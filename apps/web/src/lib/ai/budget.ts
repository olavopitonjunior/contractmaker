import { resolveAgentProfile } from "./agents/resolve";
import { agentLabel } from "./agents/store";
import type { AgentKey } from "./agents/registry";
/**
 * Budget de tokens IA por contrato.
 *
 * Estilo do `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (certidões) e do
 * `getMonthlyBudgetCents` (Clicksign), mas escopado a um contrato específico.
 * Soma todos os `AIUsage.totalTokens` registrados para o contrato e compara
 * com o teto configurado em `CONTRACT_AI_TOKEN_BUDGET` (default 200_000).
 *
 * Aplicação: chat agent (`runContractAgent`) e passive analysis
 * (`runPassiveAnalysis`) chamam `assertContractBudget` antes de gastar IA.
 * Quando estourado, retornam mensagem amigável em vez de chamar Anthropic.
 *
 * Calibração de 200k tokens (~$0.50 USD em Sonnet 4 sem cache):
 *   - Contrato típico: 8k tokens/turn × 50 turns = 400k. Limite mais agressivo
 *     que isso (200k = ~25 turns) força o usuário a aprovar antes de continuar
 *     iterando, e/ou a comprar limite extra.
 *   - Passive analysis: ~3k tokens/run. 200k cobre ~65 análises por contrato.
 *   - Após o cap de 50 ContractComment unresolved já bloquear novas passes,
 *     o budget é o backstop final.
 */

import { prisma } from "@/lib/db/prisma";

export const DEFAULT_CONTRACT_TOKEN_BUDGET = 200_000;

export class ContractBudgetExceededError extends Error {
  constructor(
    public readonly spent: number,
    public readonly budget: number
  ) {
    super(
      `Orçamento de IA do contrato esgotado: ${spent.toLocaleString("pt-BR")} / ${budget.toLocaleString("pt-BR")} tokens. Aprove o contrato ou aumente o limite em CONTRACT_AI_TOKEN_BUDGET.`
    );
    this.name = "ContractBudgetExceededError";
  }
}

export interface BudgetStatus {
  ok: boolean;
  spent: number;
  budget: number;
  pct: number;
  /** Tokens restantes (>= 0). */
  remaining: number;
}

export function getBudgetCap(): number {
  const raw = process.env.CONTRACT_AI_TOKEN_BUDGET?.trim();
  if (!raw) return DEFAULT_CONTRACT_TOKEN_BUDGET;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTRACT_TOKEN_BUDGET;
}

export async function getContractTokensSpent(contractId: string): Promise<number> {
  const agg = await prisma.aIUsage.aggregate({
    where: { contractId },
    _sum: { totalTokens: true },
  });
  // totalTokens é populado por recordAIUsage; em rows antigos pode ser 0 se
  // só prompt+completion estiveram setados. Fallback soma os pares.
  const total = agg._sum.totalTokens ?? 0;
  if (total > 0) return total;
  const fallback = await prisma.aIUsage.aggregate({
    where: { contractId },
    _sum: { promptTokens: true, completionTokens: true },
  });
  return (fallback._sum.promptTokens ?? 0) + (fallback._sum.completionTokens ?? 0);
}

export async function getContractBudgetStatus(contractId: string): Promise<BudgetStatus> {
  const budget = getBudgetCap();
  const spent = await getContractTokensSpent(contractId);
  const pct = budget > 0 ? Math.min(1, spent / budget) : 0;
  const remaining = Math.max(0, budget - spent);
  return { ok: spent < budget, spent, budget, pct, remaining };
}

// ────────────────────────────────────────────────────────────────────────────
// Budget MENSAL da org em USD (E2 governança) — teto configurável em
// Organization.aiMonthlyBudgetUsd (null = sem teto). Complementa o budget por
// contrato: o por-contrato limita um contrato "guloso"; o por-org limita o
// gasto agregado do tenant no mês.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Estoura o budget MENSAL da org (USD). Subclasse de
 * ContractBudgetExceededError pra ser pega pelos `instanceof` existentes —
 * MAS os call-sites (chat/specialist) precisam checar `instanceof
 * OrgAiBudgetExceededError` PRIMEIRO e usar `.message`, senão mostram a
 * remediação errada (aprovar contrato / env de tokens) pra um teto de org.
 * Os campos herdados `spent`/`budget` (tokens) NÃO se aplicam aqui — os
 * valores em USD ficam em `spentUsd`/`budgetUsd`.
 */
export class OrgAiBudgetExceededError extends ContractBudgetExceededError {
  constructor(
    public readonly spentUsd: number,
    public readonly budgetUsd: number
  ) {
    super(0, 0);
    this.message = `Budget mensal de IA da imobiliária esgotado: US$ ${spentUsd.toFixed(2)} / US$ ${budgetUsd.toFixed(2)} neste mês. Ajuste o teto em Configurações → Uso de IA ou aguarde o próximo mês.`;
    this.name = "OrgAiBudgetExceededError";
  }
}

export interface OrgAiBudgetStatus {
  /** null = org sem teto configurado. */
  budgetUsd: number | null;
  spentUsd: number;
  pct: number;
}

export async function getOrgAiBudgetStatus(
  orgId: string,
  opts: {
    /** Hot path (assertContractBudget): sem teto → NÃO calcula o gasto (o
     *  aggregate mensal correria 4×/turn à toa). A UI de settings NÃO passa
     *  isto — precisa do gasto real mesmo sem teto. Default false. */
    skipSpendWhenNoCap?: boolean;
  } = {}
): Promise<OrgAiBudgetStatus> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { aiMonthlyBudgetUsd: true },
  });
  const budgetUsd =
    org?.aiMonthlyBudgetUsd != null ? Number(org.aiMonthlyBudgetUsd) : null;

  if ((budgetUsd == null || budgetUsd <= 0) && opts.skipSpendWhenNoCap) {
    return { budgetUsd, spentUsd: 0, pct: 0 };
  }

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = await prisma.aIUsage.aggregate({
    where: { orgId, createdAt: { gte: firstOfMonth } },
    _sum: { estimatedCostUsd: true },
  });
  const spentUsd = Number(agg._sum.estimatedCostUsd ?? 0);
  const pct = budgetUsd && budgetUsd > 0 ? Math.min(1, spentUsd / budgetUsd) : 0;
  return { budgetUsd, spentUsd, pct };
}

/** Alerta 80%/100% no sino — dedupe mensal por threshold via batchId. */
async function maybeNotifyOrgAiBudget(
  orgId: string,
  status: OrgAiBudgetStatus
): Promise<void> {
  if (!status.budgetUsd || status.budgetUsd <= 0) return;
  const threshold = status.pct >= 1 ? 100 : status.pct >= 0.8 ? 80 : null;
  if (!threshold) return;
  try {
    const { emitNotification } = await import("@/lib/notifications/emit");
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    await emitNotification({
      orgId,
      type: "ai_budget_threshold",
      title:
        threshold === 100
          ? "Budget de IA do mês esgotado"
          : "Budget de IA em 80%",
      body:
        threshold === 100
          ? `O gasto de IA do mês (US$ ${status.spentUsd.toFixed(2)}) atingiu o teto de US$ ${status.budgetUsd.toFixed(2)}. O chat de contratos fica pausado até o próximo mês ou ajuste do teto em Configurações → Uso de IA.`
          : `O gasto de IA do mês (US$ ${status.spentUsd.toFixed(2)}) passou de 80% do teto de US$ ${status.budgetUsd.toFixed(2)}.`,
      linkUrl: "/settings/ai-usage",
      batchId: `ai-budget:${orgId}:${ym}:${threshold}`,
      metadata: { orgId, threshold, spentUsd: status.spentUsd },
    });
  } catch (err) {
    console.error("[budget] alerta de budget de IA falhou:", err);
  }
}

/**
 * Lança `ContractBudgetExceededError` se o contrato já esgotou o budget POR
 * CONTRATO ou se a ORG esgotou o budget mensal (quando configurado). Use antes
 * de cada chamada IA — não no meio. As funções consumidoras (chat / passive)
 * traduzem a exceção em resposta amigável.
 */
export async function assertContractBudget(contractId: string): Promise<BudgetStatus> {
  const status = await getContractBudgetStatus(contractId);
  if (!status.ok) {
    // O usuário vê "não consegui" na tela; sem isto o dono da plataforma só
    // descobre se for olhar o painel. Assinatura por contrato: cada contrato
    // bloqueado é UM alerta, re-armado em 24h.
    reportBudgetAlert(`contract:${contractId}`, null, {
      title: `Chat bloqueado por teto de contrato (${contractId.slice(0, 8)}…)`,
      spent: status.spent,
      budget: status.budget,
    });
    throw new ContractBudgetExceededError(status.spent, status.budget);
  }

  // Teto mensal da org (opt-in). Resolve orgId via deal.pipeline (Deal não tem
  // orgId direto). Best-effort no lookup: falha de resolução NÃO bloqueia o
  // chat — o teto é um guarda de custo, não pode virar ponto único de falha.
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { deal: { select: { pipeline: { select: { orgId: true } } } } },
    });
    const orgId = contract?.deal?.pipeline?.orgId;
    if (orgId) {
      const orgStatus = await getOrgAiBudgetStatus(orgId, { skipSpendWhenNoCap: true });
      await maybeNotifyOrgAiBudget(orgId, orgStatus);
      if (orgStatus.budgetUsd && orgStatus.pct >= 1) {
        reportBudgetAlert(`org:${orgId}`, orgId, {
          title: "IA bloqueada por teto mensal da org",
          spentUsd: orgStatus.spentUsd,
          budgetUsd: orgStatus.budgetUsd,
        });
        throw new OrgAiBudgetExceededError(orgStatus.spentUsd, orgStatus.budgetUsd);
      }
    }
  } catch (err) {
    if (err instanceof ContractBudgetExceededError) throw err;
    console.error("[budget] checagem de budget da org falhou (segue):", err);
  }

  return status;
}

/**
 * Teto mensal POR AGENTE (`AgentProfile.monthlyBudgetUsd`).
 *
 * Existe porque o teto da org é bom pra impedir a conta explodir e ruim pra
 * conter um agente específico: uma análise passiva em loop consome o orçamento
 * inteiro e derruba o chat junto. Com teto por agente, o que estourou para —
 * e só ele.
 *
 * O budget NÃO herda da plataforma (ver `resolve.ts`): teto global viraria teto
 * por tenant, e um número pensado para "a plataforma toda" aplicado a cada
 * imobiliária é um bloqueio que ninguém pediu.
 */
export class AgentBudgetExceededError extends ContractBudgetExceededError {
  constructor(
    readonly agentLabel: string,
    readonly spentUsdAgent: number,
    readonly budgetUsdAgent: number
  ) {
    super(0, 0);
    this.message =
      `O agente "${agentLabel}" atingiu o teto mensal de US$ ${budgetUsdAgent.toFixed(2)} ` +
      `(gasto: US$ ${spentUsdAgent.toFixed(2)}). Os demais agentes seguem funcionando. ` +
      `Ajuste o teto em Configurações → Agentes de IA ou aguarde a virada do mês.`;
    this.name = "AgentBudgetExceededError";
  }
}

export interface AgentBudgetStatus {
  budgetUsd: number | null;
  spentUsd: number;
  pct: number;
}

export async function getAgentBudgetStatus(
  orgId: string,
  agentKey: AgentKey
): Promise<AgentBudgetStatus> {
  const profile = await resolveAgentProfile(agentKey, orgId);
  const budgetUsd = profile.monthlyBudgetUsd;

  // Sem teto, não paga o aggregate: este caminho roda antes de cada chamada
  // ao modelo, e a maioria dos agentes não tem teto configurado.
  if (budgetUsd == null || budgetUsd <= 0) {
    return { budgetUsd: null, spentUsd: 0, pct: 0 };
  }

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = await prisma.aIUsage.aggregate({
    where: { orgId, agentKey, createdAt: { gte: firstOfMonth } },
    _sum: { estimatedCostUsd: true },
  });
  const spentUsd = Number(agg._sum.estimatedCostUsd ?? 0);
  return { budgetUsd, spentUsd, pct: Math.min(1, spentUsd / budgetUsd) };
}

/**
 * Lança quando o agente estourou o próprio teto. Best-effort: falha de leitura
 * NÃO bloqueia o turn — teto é contenção de custo, não de segurança, e negar
 * atendimento por causa de um `aggregate` que caiu é o pior dos dois erros.
 */
export async function assertAgentBudget(
  orgId: string,
  agentKey: AgentKey
): Promise<void> {
  let status: AgentBudgetStatus;
  try {
    status = await getAgentBudgetStatus(orgId, agentKey);
  } catch (err) {
    console.error(`[budget] leitura do teto de ${agentKey} falhou (segue):`, err);
    return;
  }
  if (status.budgetUsd && status.spentUsd >= status.budgetUsd) {
    reportBudgetAlert(`agent:${agentKey}:${orgId}`, orgId, {
      title: `Agente "${agentLabel(agentKey)}" bloqueado por teto mensal`,
      agentKey,
      spentUsd: status.spentUsd,
      budgetUsd: status.budgetUsd,
    });
    throw new AgentBudgetExceededError(
      agentLabel(agentKey),
      status.spentUsd,
      status.budgetUsd
    );
  }
}

/**
 * Alerta de bloqueio por teto — nos PONTOS DE THROW, não nos catches: os
 * catches são N (chat legado, orquestrador, insights, passive) e o primeiro
 * esquecido viraria bloqueio silencioso de novo. Import dinâmico +
 * fire-and-forget: o motor de alerta não pode atrasar nem quebrar o guard.
 */
function reportBudgetAlert(
  signature: string,
  orgId: string | null,
  detail: { title: string } & Record<string, unknown>
): void {
  import("@/lib/alerts/platform-alerts")
    .then(({ reportPlatformAlert }) =>
      reportPlatformAlert({
        kind: "ai_budget",
        signature,
        orgId,
        severity: "critical",
        title: detail.title,
        payload: detail,
        notify: "immediate",
      })
    )
    .catch(() => {});
}
