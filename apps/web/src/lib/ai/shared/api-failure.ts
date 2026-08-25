/**
 * Erro NOSSO × instabilidade do provedor.
 *
 * ## Por que a distinção precisa existir
 *
 * O primeiro run real de ingestão terminou com os 11 itens classificados por
 * `via: "deterministic"`. A causa não era rate limit: era um schema inválido
 * (HTTP 400 `invalid_request_error`) que o fallback determinístico engoliu em
 * silêncio, item a item. Se o planner não tivesse quebrado logo depois, o run
 * teria terminado "com sucesso" sem nunca ter usado LLM na classificação.
 *
 * O fallback existe para cobrir 429, 5xx, timeout e rede — coisas que passam
 * sozinhas. Ele NÃO pode cobrir um bug nosso: schema inválido, modelo
 * inexistente, parâmetro proibido e chave errada não melhoram com uma segunda
 * tentativa nem com degradação, e a degradação é justamente o que apaga o
 * sintoma. Este módulo é a régua que separa os dois casos.
 *
 * Fica fora de `anthropic-structured.ts` de propósito: o classificador de erro
 * é consultado por quem trata a falha, não por quem faz a chamada, e mantê-lo
 * separado deixa o módulo do cliente (que os testes substituem inteiro) com uma
 * superfície mínima.
 */

/** O que dá para dizer sobre uma chamada que falhou — o suficiente para depurar. */
export interface ApiFailure {
  /**
   * `true` = bug nosso (schema inválido, modelo inexistente, parâmetro
   * proibido, chave errada). Repetir ou degradar não conserta: só um deploy.
   */
  permanent: boolean;
  status: number | null;
  /** `invalid_request_error`, `overloaded_error`… quando a API o informa. */
  errorType: string | null;
  requestId: string | null;
  message: string;
}

/**
 * Status 4xx que, apesar da faixa, são TRANSITÓRIOS: a mesma requisição tende a
 * passar depois. `408` é timeout, `409` é concorrência, `425` é replay, `429` é
 * cota. Todo o resto do 4xx significa "a requisição está errada".
 */
const TRANSIENT_4XX = new Set([408, 409, 425, 429]);

/** Tipos de erro da API que só um deploy conserta. */
const PERMANENT_ERROR_TYPES = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
]);

function readStatus(source: Record<string, unknown>): number | null {
  const value = source.status;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** O `type` do corpo de erro da Anthropic: `{ error: { type, message } }`. */
function readErrorType(source: Record<string, unknown>): string | null {
  const body = source.error;
  if (!body || typeof body !== "object") return null;
  const inner = (body as { error?: unknown }).error;
  const target = inner && typeof inner === "object" ? inner : body;
  const type = (target as { type?: unknown }).type;
  // O envelope externo também tem `type: "error"` — não é a categoria.
  return typeof type === "string" && type !== "error" ? type : null;
}

/**
 * Classifica uma falha de chamada.
 *
 * Lê por PATO (`status`, `error`, `request_id`) em vez de `instanceof
 * APIError`: o erro pode chegar embrulhado por uma camada de retry, por um
 * `cause`, ou vir de um duplo de teste — e um `instanceof` que falha em
 * silêncio devolveria "transitório", justamente o veredicto perigoso.
 *
 * O default é transitório: sem status nem tipo (rede caiu, DNS, abort) o
 * fallback é a resposta certa.
 */
export function describeApiFailure(err: unknown): ApiFailure {
  const message = err instanceof Error ? err.message : String(err);
  const source =
    err && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const status = readStatus(source);
  const errorType = readErrorType(source);
  const rawRequestId = source.request_id;
  const requestId = typeof rawRequestId === "string" ? rawRequestId : null;

  // O tipo declarado pela API manda quando existe: é ele que separa
  // "requisição inválida" de "servidor sobrecarregado" sem depender do status.
  const permanent =
    (errorType !== null && PERMANENT_ERROR_TYPES.has(errorType)) ||
    (status !== null &&
      status >= 400 &&
      status < 500 &&
      !TRANSIENT_4XX.has(status));

  return { permanent, status, errorType, requestId, message };
}

/** Uma linha com tudo que a investigação precisa: status, tipo e `request_id`. */
export function formatApiFailure(failure: ApiFailure): string {
  return (
    `status=${failure.status ?? "-"} ` +
    `type=${failure.errorType ?? "-"} ` +
    `request_id=${failure.requestId ?? "-"} — ${failure.message}`
  );
}
