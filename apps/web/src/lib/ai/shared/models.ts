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
 * Modelos do caminho de INGESTÃO DE ACERVO (Fase A2).
 *
 * São constantes SEPARADAS das três acima de propósito, e a diferença não é
 * cosmética: as de cima são teto da família 4.6 porque todo call-site delas
 * manda `temperature` (o AgentConfig expõe temperatura configurável) e 4.7+/5
 * respondem 400 a qualquer sampling param. A ingestão não tem temperatura
 * configurável — ela roda pelo cliente de {@link ../shared/anthropic-structured},
 * que nunca envia `temperature`/`top_p`/`top_k` — então pode usar os modelos
 * atuais sem arrastar o resto do sistema junto.
 *
 * Trocar qualquer um destes IDs exige entrada correspondente na tabela `PRICING`
 * de `lib/ai/usage.ts`, senão o custo do run passa a ser gravado como zero e o
 * cap por run (`INGESTION_RUN_MAX_USD`) deixa de segurar qualquer coisa.
 */
/** Classificação por documento — barata, uma chamada por item do lote. */
export const INGEST_CLASSIFY_MODEL = "claude-haiku-4-5";
/**
 * Decisão de conjunto (lote inteiro → LibraryPlan) — uma chamada por run.
 *
 * Opus, e não Sonnet: este é o passo que define a biblioteca INTEIRA de uma
 * imobiliária, e o delta é ~US$0,16 por run — irrelevante perto do custo de
 * errar (decisão do dono do produto, 25/08/2026).
 *
 * ⚠️ No Opus 4.8, OMITIR `thinking` significa rodar SEM thinking (diferente do
 * Opus 5, onde o adaptativo é o default). `lib/ai/shared/anthropic-structured`
 * manda `thinking: {type: "adaptive"}` sempre, explicitamente, por causa disso.
 */
export const INGEST_PLAN_MODEL = "claude-opus-4-8";
/**
 * Última carta da escalação do plano.
 *
 * A PRIMEIRA escalação NÃO troca de modelo — sobe a profundidade
 * (`output_config.effort` de `high` para `xhigh`) no próprio
 * {@link INGEST_PLAN_MODEL}. Opus 5 e Opus 4.8 custam o mesmo (US$5/US$25 por
 * MTok), então subir effort é mais barato que trocar de família e mantém o
 * comportamento previsível. Este ID só entra quando nem o `xhigh` resolveu.
 */
export const INGEST_ESCALATION_MODEL = "claude-opus-5";

/**
 * Revisor pós-geração de contrato (Workstream B) — uma chamada por contrato
 * GERADO, com a flag ON por padrão para todos os tenants.
 *
 * Sonnet 5, e não Haiku/Opus (decisão do dono, 28/08/2026, com a tabela de
 * preços na mesa): mais capaz E mais barato que o Sonnet 4.6 (US$2/US$10 por
 * MTok), ~US$0,03-0,04 por revisão — e coerência jurídica pede julgamento que
 * o Haiku não entrega. Roda pelo cliente de anthropic-structured (zero
 * sampling params), então a família 5 é segura aqui.
 *
 * Override por env `CONTRACT_REVIEW_MODEL` (resolvido com `resolveModel` no
 * call-site). Trocar o ID exige entrada no `PRICING` de lib/ai/usage.ts —
 * modelo fora da tabela grava custo zero e DESLIGA o cap diário em silêncio.
 */
export const CONTRACT_REVIEW_MODEL = "claude-sonnet-5";

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
