/**
 * Consentimento LGPD para consulta de crédito — client-safe, puro.
 *
 * Vive em `complianceJson` (Deal, Proposal e LeaseClient) sob a chave
 * `creditConsent`. Aceita também a chave legada `serasaConsent` (2026-05):
 * as rotas de deal/LeaseClient gravaram consentimento com esse nome e ele
 * continua válido — a base legal é a mesma (proteção do crédito, LGPD art. 7º,
 * X), independentemente do bureau. Ler pelas duas chaves é o que impede um
 * consentimento já dado de virar um 412 depois da troca de provedor.
 */

export type CreditConsentBaseLegal = "protecao_credito" | "execucao_contrato";

export interface CreditConsent {
  /** ISO. */
  at: string;
  /** userId de quem registrou. */
  by: string;
  baseLegal: CreditConsentBaseLegal;
  /** Provedor no momento do registro (informativo). */
  provider?: string;
}

const CANONICAL_KEY = "creditConsent";
const LEGACY_KEY = "serasaConsent";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseConsent(v: unknown): CreditConsent | null {
  const r = asRecord(v);
  if (typeof r.at !== "string" || !r.at) return null;
  const baseLegal: CreditConsentBaseLegal =
    r.baseLegal === "execucao_contrato" ? "execucao_contrato" : "protecao_credito";
  return {
    at: r.at,
    by: typeof r.by === "string" ? r.by : "",
    baseLegal,
    ...(typeof r.provider === "string" && r.provider ? { provider: r.provider } : {}),
  };
}

/** Consentimento vigente, ou null. Canônico vence o legado. */
export function readCreditConsent(complianceJson: unknown): CreditConsent | null {
  const c = asRecord(complianceJson);
  return parseConsent(c[CANONICAL_KEY]) ?? parseConsent(c[LEGACY_KEY]);
}

export function hasCreditConsent(complianceJson: unknown): boolean {
  return readCreditConsent(complianceJson) !== null;
}

/** Novo `complianceJson` com o consentimento gravado na chave canônica. */
export function withCreditConsent(
  complianceJson: unknown,
  consent: CreditConsent
): Record<string, unknown> {
  return { ...asRecord(complianceJson), [CANONICAL_KEY]: consent };
}

/** Novo `complianceJson` sem consentimento (revogação) — apaga as duas chaves. */
export function withoutCreditConsent(complianceJson: unknown): Record<string, unknown> {
  const c = { ...asRecord(complianceJson) };
  delete c[CANONICAL_KEY];
  delete c[LEGACY_KEY];
  return c;
}
