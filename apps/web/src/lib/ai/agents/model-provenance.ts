/**
 * Modelo EFETIVO de cada agente, com procedência — a resposta a "que modelo
 * este agente vai usar no próximo turn, e quem decidiu isso?".
 *
 * Por que existe: a cadeia perfil → env → hardcoded estava espalhada nos
 * call-sites (agent.ts pro passivo e pro legado, ocr.ts pro Gemini) e era
 * invisível a qualquer tela. Foi exatamente por aí que um modelo APOSENTADO
 * (claude-sonnet-4-20250514, via env) rodou a análise passiva por dois meses
 * — a maior linha de custo do período — sem nenhuma tela acusar.
 *
 * Regra de ouro: OS CALL-SITES USAM ESTE MÓDULO. Se a tela e o runtime não
 * compartilham a resolução, a tela vira uma estimativa — e estimativa foi o
 * que deixou o aposentado rodar. Qualquer mudança de precedência acontece
 * aqui, uma vez, e vale pros dois.
 *
 * Nota de escopo: alguns agentes têm MAIS de um modelo por contexto (passivo:
 * open/edit; legado e agregador: fast/plan). "O modelo do agente" não é uma
 * string — é uma lista de (contexto, modelo, fonte).
 */

import { HAIKU_MODEL, SONNET_MODEL, resolveModel } from "../shared/models";
import type { AgentKey } from "./registry";
import type { ResolvedAgentProfile } from "./resolve";

export type ModelSource =
  /** Override gravado no AgentProfile da org. */
  | "org"
  /** Override gravado no AgentProfile de plataforma. */
  | "platform"
  /** Variável de ambiente (o caminho que nenhuma tela via). */
  | "env"
  /** Decidido pelo código por contexto (ex.: fast = sempre Haiku) — perfil e env não participam. */
  | "fixed"
  /** Hardcoded do registry — ninguém configurou nada. */
  | "default";

export interface ModelProvenance {
  /** null = vale pra todo uso do agente; senão o contexto (open/edit/fast/plan). */
  context: string | null;
  model: string;
  source: ModelSource;
  /** Preenchido quando source === "env": qual variável forneceu o valor. */
  envVar: string | null;
}

type Env = Record<string, string | undefined>;

/**
 * Primeira env NÃO-VAZIA da cadeia, migrada por resolveModel. `||` (não `??`)
 * de propósito: env setada como string vazia não pode engolir o fallback —
 * mesma regra que o call-site do passivo sempre aplicou.
 */
function fromEnvChain(
  env: Env,
  vars: string[],
  fallback: string
): { model: string; envVar: string | null } {
  for (const v of vars) {
    if (env[v]) return { model: resolveModel(env[v], fallback), envVar: v };
  }
  return { model: fallback, envVar: null };
}

function fromProfile(p: ResolvedAgentProfile): ModelProvenance {
  return {
    context: null,
    model: p.model,
    source: p.modelSource === "default" ? "default" : p.modelSource,
    envVar: null,
  };
}

/** OCR roda no Gemini e nunca leu perfil — a cadeia é env → hardcoded, só. */
export function ocrModelFromEnv(env: Env = process.env): string {
  return env.GEMINI_OCR_MODEL || "gemini-2.5-flash";
}

/**
 * Modelo do passe passivo por trigger. Call-site: runPassiveAnalysis.
 * Configuração no console vence os envs; sem configuração
 * (`modelSource === "default"`) a cadeia de envs continua como sempre foi.
 */
export function passiveEffectiveModel(
  profile: ResolvedAgentProfile,
  trigger: "open" | "edit",
  env: Env = process.env
): string {
  if (profile.modelSource !== "default") return profile.model;
  return trigger === "open"
    ? fromEnvChain(env, ["ANTHROPIC_PASSIVE_OPEN_MODEL", "ANTHROPIC_MODEL"], SONNET_MODEL).model
    : fromEnvChain(env, ["ANTHROPIC_PASSIVE_MODEL"], HAIKU_MODEL).model;
}

/**
 * Modelo do chat legado por modo. Call-site: getAgentConfig (agent.ts).
 * `fast` é fixo em Haiku por latência — sobrepõe até o perfil.
 */
export function chatLegacyEffectiveModel(
  profile: ResolvedAgentProfile,
  mode: "fast" | "plan",
  env: Env = process.env
): string {
  if (mode === "fast") return HAIKU_MODEL;
  if (profile.modelSource !== "default") return profile.model;
  return fromEnvChain(env, ["ANTHROPIC_MODEL"], profile.model).model;
}

/**
 * A visão completa por agente, pra tela de procedência do /admin.
 * NÃO inventa entrada pra agente sem caminho especial: quem resolve só pelo
 * perfil ganha uma entrada única com a fonte do próprio perfil.
 */
export function effectiveModels(
  agentKey: AgentKey,
  profile: ResolvedAgentProfile,
  env: Env = process.env
): ModelProvenance[] {
  switch (agentKey) {
    case "passive": {
      if (profile.modelSource !== "default") return [fromProfile(profile)];
      const open = fromEnvChain(
        env,
        ["ANTHROPIC_PASSIVE_OPEN_MODEL", "ANTHROPIC_MODEL"],
        SONNET_MODEL
      );
      const edit = fromEnvChain(env, ["ANTHROPIC_PASSIVE_MODEL"], HAIKU_MODEL);
      return [
        {
          context: "open",
          model: open.model,
          source: open.envVar ? "env" : "default",
          envVar: open.envVar,
        },
        {
          context: "edit",
          model: edit.model,
          source: edit.envVar ? "env" : "default",
          envVar: edit.envVar,
        },
      ];
    }
    case "chat_legacy": {
      const plan: ModelProvenance =
        profile.modelSource !== "default"
          ? { ...fromProfile(profile), context: "plan" }
          : (() => {
              const r = fromEnvChain(env, ["ANTHROPIC_MODEL"], profile.model);
              return {
                context: "plan",
                model: r.model,
                source: r.envVar ? "env" : "default",
                envVar: r.envVar,
              } as ModelProvenance;
            })();
      return [
        { context: "fast", model: HAIKU_MODEL, source: "fixed", envVar: null },
        plan,
      ];
    }
    case "aggregator":
      // graph.ts:353 — fixo por modo; perfil e env não participam (e o
      // registry declara supports.model: false por isso).
      return [
        { context: "fast", model: HAIKU_MODEL, source: "fixed", envVar: null },
        { context: "plan", model: SONNET_MODEL, source: "fixed", envVar: null },
      ];
    case "ocr": {
      const m = ocrModelFromEnv(env);
      return [
        {
          context: null,
          model: m,
          source: env.GEMINI_OCR_MODEL ? "env" : "default",
          envVar: env.GEMINI_OCR_MODEL ? "GEMINI_OCR_MODEL" : null,
        },
      ];
    }
    default:
      // analyst/legal/editor/curator/insights/support/max: perfil resolve
      // direto, sem camada env — verificado call-site a call-site.
      return [fromProfile(profile)];
  }
}
