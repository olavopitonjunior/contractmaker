/**
 * Resolução do perfil de um agente, em cadeia:
 *
 *   linha da org (AgentProfile.orgId = orgId)
 *     → linha da plataforma (AgentProfile.orgId IS NULL)
 *       → hardcoded (AGENT_REGISTRY)
 *
 * Campo null em qualquer nível significa HERDA, não "vazio" — é o que permite
 * a org sobrescrever só a instrução sem perder o modelo da plataforma.
 *
 * Duas regras herdadas do `platform-defaults.ts` que este módulo substitui e
 * que NÃO podem se perder:
 *  1. Cache em módulo com TTL curto. O loader roda a cada turn de chat (4
 *     especialistas + aggregator) numa linha que muda raramente.
 *  2. Falha de DB nunca derruba o chat — cai no hardcoded.
 *
 * `instructions` é sempre APÊNDICE ao prompt-base (que é escolhido por domínio,
 * venda × locação). Substituir o prompt inteiro apagaria a variante de locação.
 */

import { prisma } from "@/lib/db/prisma";
import { resolveModel } from "../shared/models";
import { AGENT_REGISTRY, type AgentKey } from "./registry";

export interface ResolvedAgentProfile {
  agentKey: AgentKey;
  enabled: boolean;
  model: string;
  /**
   * De onde o `model` veio. `"default"` significa que ninguém configurou —
   * é o que permite a um call-site preservar seu próprio fallback (ex.: o
   * legado ainda respeita `ANTHROPIC_MODEL`) sem confundir "não configurado"
   * com "configurado igual ao default".
   */
  modelSource: "org" | "platform" | "default";
  fallbackModel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  /** Instrução da PLATAFORMA (precedência sobre o prompt-base). */
  platformInstructions: string | null;
  /** Instrução do TENANT (entra cercada, tratada como dado de terceiro). */
  tenantInstructions: string | null;
  ragScope: RagScope | null;
  monthlyBudgetUsd: number | null;
  config: Record<string, unknown> | null;
}

export interface RagScope {
  categories?: string[];
  tags?: string[];
  includePlatform?: boolean;
}

const TTL_MS = 60_000;

/** Chave do cache: `${orgId ?? "-"}:${agentKey}`. */
const cache = new Map<string, { at: number; value: ResolvedAgentProfile }>();

type ProfileRow = {
  enabled: boolean;
  model: string | null;
  fallbackModel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  instructions: string | null;
  ragScope: unknown;
  monthlyBudgetUsd: unknown;
  config: unknown;
};

const SELECT = {
  enabled: true,
  model: true,
  fallbackModel: true,
  temperature: true,
  maxTokens: true,
  instructions: true,
  ragScope: true,
  monthlyBudgetUsd: true,
  config: true,
} as const;

function norm(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function asRagScope(v: unknown): RagScope | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as RagScope;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** Decimal do Prisma, number ou string → number. */
function asNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function hardcoded(agentKey: AgentKey): ResolvedAgentProfile {
  const def = AGENT_REGISTRY[agentKey];
  return {
    agentKey,
    enabled: true,
    model: def.defaultModel,
    modelSource: "default",
    fallbackModel: null,
    temperature: def.defaultTemperature ?? null,
    maxTokens: def.defaultMaxTokens ?? null,
    platformInstructions: null,
    tenantInstructions: null,
    ragScope: null,
    monthlyBudgetUsd: null,
    config: null,
  };
}

/**
 * @param orgId `null` resolve só o nível de plataforma (usado pelo /admin).
 */
export async function resolveAgentProfile(
  agentKey: AgentKey,
  orgId: string | null
): Promise<ResolvedAgentProfile> {
  const key = `${orgId ?? "-"}:${agentKey}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const base = hardcoded(agentKey);

  let platform: ProfileRow | null = null;
  let org: ProfileRow | null = null;
  try {
    [platform, org] = await Promise.all([
      prisma.agentProfile.findFirst({
        where: { orgId: null, agentKey },
        select: SELECT,
      }),
      orgId
        ? prisma.agentProfile.findUnique({
            where: { orgId_agentKey: { orgId, agentKey } },
            select: SELECT,
          })
        : Promise.resolve(null),
    ]);
  } catch (err) {
    // Nunca derruba o chat — o hardcoded é sempre uma configuração válida.
    console.error(`[agent-profile] load falhou (${key}), usando hardcoded:`, err);
    return hit?.value ?? base;
  }

  const pick = <T>(o: T | null, p: T | null, fallback: T): T =>
    o ?? p ?? fallback;

  const orgModel = norm(org?.model);
  const platformModel = norm(platform?.model);
  const modelSource: ResolvedAgentProfile["modelSource"] = orgModel
    ? "org"
    : platformModel
      ? "platform"
      : "default";

  const value: ResolvedAgentProfile = {
    agentKey,
    // `enabled` é o único campo em que o desligamento vence: se a plataforma
    // desligou o agente, o tenant não reativa.
    enabled: (platform?.enabled ?? true) && (org?.enabled ?? true),
    model: resolveModel(orgModel ?? platformModel ?? undefined, base.model),
    modelSource,
    // Passa por resolveModel igual ao principal: um alias aposentado gravado
    // aqui daria 404 justamente no caminho de contingência de 429/529, que é
    // quando ninguém quer descobrir um segundo erro.
    fallbackModel: (() => {
      const raw = pick(norm(org?.fallbackModel), norm(platform?.fallbackModel), null);
      return raw ? resolveModel(raw, raw) : null;
    })(),
    temperature: pick(
      org?.temperature ?? null,
      platform?.temperature ?? null,
      base.temperature
    ),
    maxTokens: pick(
      org?.maxTokens ?? null,
      platform?.maxTokens ?? null,
      base.maxTokens
    ),
    platformInstructions: norm(platform?.instructions),
    tenantInstructions: norm(org?.instructions),
    ragScope: pick(
      asRagScope(org?.ragScope),
      asRagScope(platform?.ragScope),
      null
    ),
    // Budget só faz sentido no escopo em que o gasto acontece — não herda
    // da plataforma, senão um teto global viraria teto por tenant.
    monthlyBudgetUsd: asNumber(org?.monthlyBudgetUsd),
    config: pick(asRecord(org?.config), asRecord(platform?.config), null),
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Só pra teste: zera o cache entre casos. */
export function __resetAgentProfileCacheForTests() {
  cache.clear();
}

/**
 * Invalida o cache após escrita no console — sem isso o admin salva e espera
 * até 60s pra ver efeito, o que parece bug.
 */
export function invalidateAgentProfileCache(
  orgId: string | null,
  agentKey?: AgentKey
) {
  if (!agentKey) {
    for (const k of [...cache.keys()]) {
      if (k.startsWith(`${orgId ?? "-"}:`)) cache.delete(k);
    }
    return;
  }
  cache.delete(`${orgId ?? "-"}:${agentKey}`);
  // Mexer na plataforma muda o resolvido de TODA org que herdava.
  if (orgId === null) {
    for (const k of [...cache.keys()]) {
      if (k.endsWith(`:${agentKey}`)) cache.delete(k);
    }
  }
}
