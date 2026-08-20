/**
 * Normalização e validação de contato do cadastro de corretor
 * (SplitRecipient kind="commissioner"). Compartilhado pelos 5 pontos de
 * escrita: POST/PATCH admin (/api/financeiro/split-recipients), registry
 * (lib/asaas/commissioner-registry — cobre form público e auto-cadastro do
 * finalize) e bulk-import.
 *
 * Telefone: o formato canônico de GRAVAÇÃO é o E.164 do normalizeBrPhone
 * (+55DDNNNNNNNNN) — o MESMO normalizador que o Max (broker-scope), o
 * notify-trigger e o deal-events usam na leitura. Não criar outro normalizador:
 * duas implementações divergindo fazem o Max parar de reconhecer corretor
 * silenciosamente (o índice parcial (orgId, phone) WHERE maxEnabled AND active
 * serve exatamente essa varredura).
 */

import { normalizeBrPhone } from "@/lib/validators/phone-br";
import { isValidCpfCnpj } from "@/lib/validators/cnpj";

export { isValidCpfCnpj };

/** trim + lowercase; vazio → null. (Match de signer no ClickSign compara
 *  email lowercase — gravar canônico evita mismatch.) */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v || null;
}

/**
 * Telefone pra gravação. Parseável → E.164 (+55...). Não-parseável:
 * - strict: null + flag `invalid` (API admin devolve 422)
 * - soft (form público/auto-cadastro): mantém o cru trimado — origem anônima
 *   não pode perder dado; o backfill/edição admin corrige depois.
 */
export function normalizePhoneForStorage(
  raw: string | null | undefined,
  opts?: { soft?: boolean }
): { value: string | null; invalid: boolean } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { value: null, invalid: false };
  const e164 = normalizeBrPhone(trimmed);
  if (e164) return { value: e164, invalid: false };
  return opts?.soft
    ? { value: trimmed, invalid: false }
    : { value: null, invalid: true };
}

/** CRECI: dígitos (1-7) com UF e sufixo F/J opcionais — "12345", "12345-F",
 *  "SP-12345", "CRECI/SP 12345-J". Só formato; sem consulta externa. */
const CRECI_RE = /^(?:CRECI[\s/-]*)?(?:[A-Z]{2}[\s/-]*)?\d{1,7}(?:[\s/-]*[FJ])?(?:[\s/-]*[A-Z]{2})?$/i;

export function isValidCreci(raw: string): boolean {
  return CRECI_RE.test(raw.trim());
}
