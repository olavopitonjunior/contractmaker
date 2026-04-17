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
  | "account_issue"
  | "genuine_no_data"
  | "unknown";

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
  602: "genuine_no_data",
  603: "account_issue",            // Infosimples balance exhausted
  604: "account_issue",            // invalid token
  605: "genuine_no_data",
  606: "missing_input",            // required field missing
  607: "missing_input",
  608: "missing_input",
  609: "inconsistent_input",       // field format ok but rejected by portal
  610: "inconsistent_input",
  611: "inconsistent_input",
  612: "missing_input",            // CPF invalid
  613: "missing_input",            // CNPJ invalid
  614: "inconsistent_input",       // birthdate mismatch
  615: "inconsistent_input",       // name mismatch
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

export function mapInfosimplesCodeToCategory(
  code: number,
  codeMessage?: string | null
): FailureCategory {
  if (code === 200) return "unknown"; // shouldn't be called for success
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
  account_issue: "Problema de conta",
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
  account_issue:
    "Há um problema com a conta Infosimples (saldo/token). Verifique com o administrador.",
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
