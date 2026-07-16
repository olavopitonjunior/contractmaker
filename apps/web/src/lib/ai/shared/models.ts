/**
 * IDs canônicos de modelo Anthropic usados no sistema. Módulo puro (sem
 * import do SDK) — seguro pra client components (AgentSettings) e pro server.
 *
 * IMPORTANTE: escolher modelos que aceitam `temperature` — o AgentConfig expõe
 * temperatura configurável e a família 4.7+/Sonnet 5 rejeita sampling params
 * com 400. Por isso o teto aqui é a família 4.6.
 */
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-4-6";
export const OPUS_MODEL = "claude-opus-4-6";

/**
 * Modelos aposentados/deprecados → substituto atual. A Anthropic retorna 404
 * pra IDs aposentados (visto em prod 2026-07-15: auto-analyze quebrou com
 * claude-sonnet-4-20250514). O ID antigo pode sobreviver em 3 lugares que
 * deploy nenhum corrige sozinho: AgentConfig.model no banco, envs
 * ANTHROPIC_MODEL/ANTHROPIC_PASSIVE_MODEL na Vercel e payloads antigos.
 * Mapear aqui garante que nenhum tenant (atual ou novo) volte a quebrar.
 */
const RETIRED_MODEL_MIGRATIONS: Record<string, string> = {
  "claude-sonnet-4-20250514": SONNET_MODEL,
  "claude-opus-4-20250514": OPUS_MODEL,
  "claude-3-7-sonnet-20250219": SONNET_MODEL,
  "claude-3-5-sonnet-20241022": SONNET_MODEL,
  "claude-3-5-sonnet-20240620": SONNET_MODEL,
  "claude-3-5-haiku-20241022": HAIKU_MODEL,
  "claude-3-haiku-20240307": HAIKU_MODEL,
  "claude-3-opus-20240229": OPUS_MODEL,
};

/**
 * Resolve um candidato a modelo (env, AgentConfig do banco, payload) pro ID
 * utilizável: migra aposentados, aplica fallback quando vazio e passa adiante
 * IDs desconhecidos (podem ser modelos novos válidos).
 */
export function resolveModel(
  candidate: string | null | undefined,
  fallback: string = SONNET_MODEL
): string {
  const trimmed = candidate?.trim();
  if (!trimmed) return fallback;
  return RETIRED_MODEL_MIGRATIONS[trimmed] ?? trimmed;
}
