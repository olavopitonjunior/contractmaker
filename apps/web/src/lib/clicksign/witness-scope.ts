/**
 * Scopes do cadastro de testemunhas (por módulo). Módulo-safe / client-safe
 * (sem imports de servidor) — usado pela UI de cadastro, pelos diálogos de envio
 * e pelas rotas de API.
 *
 * NÃO reusa `ModuleKey` (lib/modules/catalog.ts) de propósito: "proposta" não é
 * um módulo do catálogo (propostas são uma FEATURE de vendas), então o scope de
 * testemunhas é um conjunto próprio. Os valores "venda"/"locacao" batem com
 * `pipelineKind(...)` (lib/modules/resolve.ts) pra derivar o scope do deal.
 */
export const WITNESS_SCOPES = ["venda", "locacao", "proposta"] as const;

export type WitnessScope = (typeof WITNESS_SCOPES)[number];

export const DEFAULT_WITNESS_SCOPE: WitnessScope = "venda";

export function isWitnessScope(v: unknown): v is WitnessScope {
  return typeof v === "string" && (WITNESS_SCOPES as readonly string[]).includes(v);
}

/** Normaliza um valor livre para um scope válido (fallback "venda"). */
export function toWitnessScope(v: unknown): WitnessScope {
  return isWitnessScope(v) ? v : DEFAULT_WITNESS_SCOPE;
}

/** Rótulo PT-BR do scope, pra tabs/segmented na UI. */
export const WITNESS_SCOPE_LABEL: Record<WitnessScope, string> = {
  venda: "Venda",
  locacao: "Locação",
  proposta: "Propostas",
};
