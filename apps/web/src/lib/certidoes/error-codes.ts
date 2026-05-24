/**
 * Maps Infosimples response codes into semantic categories so the UI can
 * render differentiated UX per category instead of lumping every 6xx into
 * a generic "não emitida" state.
 *
 * Source: Infosimples docs + live tests. Ranges are defensively covered —
 * unknown codes inside a known range fall back to the range's default
 * category, and truly unknown codes fall to "unknown".
 *
 * The categorization drives:
 *   - Card badge color / label in CertidoesTab.tsx
 *   - CTA shown (retry, edit party, complete data, contact admin, etc.)
 *   - Whether auto-retry schedules (rate_limited, portal_unavailable)
 *   - Whether the error is "data issue" (user fixable) vs "system issue"
 */

export type FailureCategory =
  | "missing_input"
  | "inconsistent_input"
  | "portal_unavailable"
  | "rate_limited"
  | "provider_timeout"     // F.II-α: nosso timeout expirou antes de resposta do provider
  | "account_issue"
  | "integration_error"    // F.II-α: HTTP 5xx nosso, JSON parse fail, normalizer crash, executor exception
  | "genuine_no_data"
  | "unknown";

/**
 * Phase F.II-α — 3-way UX grouping. Each FailureCategory belongs to one of
 * three semantic groups that drive different UI affordances:
 *   - GRUPO_DADO: usuário corrige dados da parte/imóvel (editar parte dialog)
 *   - GRUPO_PROVEDOR: Infosimples ou portal oficial — nós esperamos/retry automático
 *   - GRUPO_INTEGRACAO: bug nosso — botão "Reportar" + link suporte
 */
export type FailureGroup = "dado" | "provedor" | "integracao";

export const FAILURE_GROUP: Record<FailureCategory, FailureGroup> = {
  missing_input: "dado",
  inconsistent_input: "dado",
  portal_unavailable: "provedor",
  rate_limited: "provedor",
  provider_timeout: "provedor",
  account_issue: "provedor",
  integration_error: "integracao",
  genuine_no_data: "provedor", // tecnicamente sucesso, mas UX trata como informativa
  unknown: "integracao",
};

export const GROUP_LABEL: Record<FailureGroup, string> = {
  dado: "Dados da parte",
  provedor: "Portal / Provedor",
  integracao: "Sistema (nosso)",
};

/**
 * Known code → category mapping. Only lists codes we've observed in practice
 * or that Infosimples documents explicitly. The function below also has a
 * range-based fallback for nearby codes.
 */
const CODE_MAP: Record<number, FailureCategory> = {
  // 2xx — success (should never be mapped to failure)
  // 200 → no failure

  // 6xx — business errors
  600: "genuine_no_data",          // no record found for the query
  601: "genuine_no_data",
  602: "integration_error",        // "serviço informado na URL não é válido" — endpoint deprecado/mudou
  603: "account_issue",             // Infosimples balance exhausted
  604: "account_issue",             // invalid token
  605: "portal_unavailable",        // portal offline / timeout
  606: "missing_input",            // required field missing
  607: "missing_input",
  608: "missing_input",
  609: "inconsistent_input",       // field format ok but rejected by portal
  610: "inconsistent_input",
  611: "inconsistent_input",
  612: "missing_input",            // CPF invalid
  613: "missing_input",            // CNPJ invalid
  614: "inconsistent_input",       // birthdate mismatch
  615: "portal_unavailable",       // portal retornou erro / site indisponível (Infosimples docs)
  616: "inconsistent_input",

  // 66x — portal state
  665: "portal_unavailable",
  666: "portal_unavailable",       // portal down / unreachable
  667: "portal_unavailable",       // portal returned unexpected error
  668: "rate_limited",             // daily quota on portal side
  669: "rate_limited",

  // 7xx — authentication / captcha / login
  701: "inconsistent_input",
  702: "inconsistent_input",
  703: "portal_unavailable",
};

/**
 * Heuristic matchers over the `code_message` text. Applied only when the
 * numeric code isn't in CODE_MAP — keywords catch new/unknown codes that
 * Infosimples rolls out without updating our table.
 */
const MESSAGE_HEURISTICS: Array<{
  match: RegExp;
  category: FailureCategory;
}> = [
  { match: /saldo|sem cr[eé]dito/i, category: "account_issue" },
  { match: /token inv[aá]lido|token expired/i, category: "account_issue" },
  { match: /cpf.*inv[aá]lido|cnpj.*inv[aá]lido|documento.*inv[aá]lido/i, category: "missing_input" },
  { match: /campo.*obrigat[oó]rio|informe.*obrigat/i, category: "missing_input" },
  { match: /n[aã]o (confere|corresponde|bate|combina)|divergente/i, category: "inconsistent_input" },
  { match: /portal.*indispon[ií]vel|portal.*fora|site fora/i, category: "portal_unavailable" },
  { match: /timeout|tempo (esgotado|limite)/i, category: "portal_unavailable" },
  { match: /limite (di[aá]rio|de consultas)|quota|too many|429/i, category: "rate_limited" },
  { match: /nada consta|n[aã]o encontrado|nenhum registro|n[aã]o h[aá]/i, category: "genuine_no_data" },
];

/**
 * e-SAJ `pedido-certidao` recusa com code 604 quando o MESMO e-mail é usado em
 * pedidos repetidos num intervalo curto ("Não é possível utilizar o mesmo email
 * múltiplas vezes... Aguarde, ou tente novamente com outro email"). Isso é
 * TRANSITÓRIO (rate-limit de e-mail), NÃO esgotamento de crédito/token. Sem
 * discriminar, cairia em `account_issue` → tripava o circuit-breaker de crédito
 * (isOrgInfosimplesBlocked) e bloqueava toda a org por 30min. Gate por mensagem.
 */
export function isEmailThrottle(message: string | null | undefined): boolean {
  if (!message) return false;
  return /mesmo\s+email\s+m[uú]ltiplas\s+vezes|tente\s+novamente\s+com\s+outro\s+email/i.test(
    message
  );
}

export function mapInfosimplesCodeToCategory(
  code: number,
  codeMessage?: string | null
): FailureCategory {
  if (code === 200) return "unknown"; // shouldn't be called for success
  // 604 do throttle de e-mail (e-SAJ pedido-certidao) é transitório, não conta.
  if (code === 604 && isEmailThrottle(codeMessage)) return "rate_limited";
  if (code in CODE_MAP) return CODE_MAP[code];

  // Message heuristics fire for unmapped codes
  const msg = (codeMessage ?? "").trim();
  if (msg) {
    for (const { match, category } of MESSAGE_HEURISTICS) {
      if (match.test(msg)) return category;
    }
  }

  // Range-based fallback for unmapped 6xx codes
  if (code >= 600 && code <= 619) return "missing_input";
  if (code >= 660 && code <= 679) return "portal_unavailable";
  if (code >= 700 && code <= 799) return "inconsistent_input";
  return "unknown";
}

/**
 * User-facing label per category. Kept short (≤ 3 words) for badge display.
 */
export const CATEGORY_LABEL: Record<FailureCategory, string> = {
  missing_input: "Dados insuficientes",
  inconsistent_input: "Dados divergentes",
  portal_unavailable: "Portal indisponível",
  rate_limited: "Limite atingido",
  provider_timeout: "Tempo esgotado",
  account_issue: "Problema de conta",
  integration_error: "Erro interno do sistema",
  genuine_no_data: "Nada consta",
  unknown: "Resultado incerto",
};

/**
 * Longer description for tooltip / detail view.
 */
export const CATEGORY_DESCRIPTION: Record<FailureCategory, string> = {
  missing_input:
    "Algum dado obrigatório está ausente ou mal formatado. Complete o cadastro da parte e tente novamente.",
  inconsistent_input:
    "O portal rejeitou porque os dados não conferem (nome, data de nascimento etc). Edite e reenvie.",
  portal_unavailable:
    "O portal oficial está fora do ar ou com timeout. Tente novamente em alguns minutos.",
  rate_limited:
    "Atingimos o limite diário de consultas neste portal. Aguarde e tente novamente.",
  provider_timeout:
    "A consulta demorou mais que o esperado. O provedor pode estar sobrecarregado. Tente novamente.",
  account_issue:
    "Há um problema com a conta Infosimples (saldo/token). Verifique com o administrador.",
  integration_error:
    "Erro interno do sistema durante a consulta. Nossa equipe foi notificada. Tente novamente ou reporte o bug.",
  genuine_no_data:
    "O portal respondeu mas não há certidão a emitir para este documento.",
  unknown: "Resultado inconclusivo. Tente novamente ou contate o suporte.",
};

/**
 * Whether the category is user-fixable (show edit/complete CTAs) vs systemic
 * (show retry/contact-admin).
 */
export function isUserFixable(cat: FailureCategory): boolean {
  return cat === "missing_input" || cat === "inconsistent_input";
}

/**
 * Whether an automatic retry makes sense (transient system issue).
 */
export function shouldAutoRetry(cat: FailureCategory): boolean {
  return cat === "portal_unavailable" || cat === "rate_limited";
}

/**
 * CENPROT/IEPTB (protestos) sinaliza "não constam protestos" como erro 6xx
 * (tipicamente 612, sem PDF e sem `data`) em vez de code 200 + situacao
 * negativa. A mensagem é uma afirmação DEFINITIVA de ausência ("não constam
 * protestos nos cartórios participantes, cuja abrangência ... é de 100%"),
 * não uma falha de portal/dado.
 *
 * Sem tratamento especial isso cai em missing_input → failed_permanent
 * (vermelho, "use o portal oficial"), apresentando um resultado LIMPO como
 * falha. Esta detecção permite tratar o caso como negativa ("nada consta").
 *
 * Decisão de produto (2026-05-21): é uma EXCEÇÃO consciente ao princípio
 * anti-falso-negativo (negativa sem PDF), gated na mensagem explícita +
 * endpoint de protesto. NÃO casa com "fetch failed" (erro de transporte),
 * "CPF inválido", nem "portal indisponível" — esses continuam falha/retry.
 */
export function isProtestoNadaConsta(
  endpoint: string,
  message: string | null | undefined
): boolean {
  if (!message) return false;
  if (!/cenprot|ieptb|protesto/i.test(endpoint)) return false;
  return /n[ãa]o\s+constam?\s+protestos?|nada\s+consta|n[ãa]o\s+h[áa]\s+protestos?/i.test(
    message
  );
}

/**
 * Portais two-step (e-SAJ TJSP/TJRJ) recusam um pedido com code 620 quando JÁ
 * EXISTE um pedido do mesmo tipo em processamento (ex.: o usuário re-disparou
 * a certidão enquanto a tentativa anterior ainda rodava). A resposta NÃO traz
 * `numero_pedido` (não dá pra buscar por aqui) — a certidão será emitida pela
 * tentativa original. Detecção usada pra marcar `duplicate_pending` (estado
 * neutro "pedido já em andamento" + ETA) em vez de failed_permanent vermelho.
 *
 * ATENÇÃO: code 620 é GENÉRICO na Infosimples — também aparece pra problemas
 * de 2FA/autenticação GOV.BR ("verificação em duas etapas está ativada"). Por
 * isso o gate é a mensagem específica de pedido duplicado, NÃO o code sozinho.
 */
export function isPedidoDuplicado(
  message: string | null | undefined
): boolean {
  if (!message) return false;
  return /j[áa]\s+existe.*pedido|aguarde\s+o\s+processamento\s+do\s+pedido/i.test(
    message
  );
}

/**
 * Decisão pura do 2º passo (obter) de portais two-step, dado o code/categoria
 * da resposta. Substitui o "todo 6xx → reagenda pra sempre" (que escondia erro
 * de crédito por 14 dias e drenava saldo). Regras:
 *   - account_issue (603/604) / integration_error (602) → falha IMEDIATA
 *     (não se resolve repetindo: token/crédito/endpoint inválido).
 *   - transitório (portal_unavailable/rate_limited/provider_timeout) → retry
 *     limitado a `maxRetries` (3); esgotado → falha.
 *   - demais (genuíno "ainda processando") → aguarda até `maxWaitMs`; estourou
 *     o prazo → falha.
 * `attempts` é a tentativa ATUAL (retryCount + 1).
 */
export type ObterPollAction =
  | { action: "fail"; reason: "account" | "integration" | "transient_exhausted" | "deadline" }
  | { action: "retry" }
  | { action: "wait" };

export function decideObterOutcome(
  category: FailureCategory,
  ctx: { ageMs: number; attempts: number; maxRetries: number; maxWaitMs: number }
): ObterPollAction {
  if (category === "account_issue") return { action: "fail", reason: "account" };
  if (category === "integration_error")
    return { action: "fail", reason: "integration" };
  if (
    category === "portal_unavailable" ||
    category === "rate_limited" ||
    category === "provider_timeout"
  ) {
    return ctx.attempts >= ctx.maxRetries
      ? { action: "fail", reason: "transient_exhausted" }
      : { action: "retry" };
  }
  return ctx.ageMs > ctx.maxWaitMs
    ? { action: "fail", reason: "deadline" }
    : { action: "wait" };
}
