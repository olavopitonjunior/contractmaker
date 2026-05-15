/**
 * Sanitização de payload Serasa antes de persistir em CertidaoJob.requestPayload.
 *
 * Remove credenciais, tokens de auth e headers sensíveis pra evitar vazamento
 * em DB / logs / audit / retry replay. Espelha o pattern de
 * `lib/certidoes/infosimples.ts::sanitizePayload`.
 */

const SENSITIVE_KEYS = new Set([
  "client_id",
  "clientId",
  "client_secret",
  "clientSecret",
  "access_token",
  "accessToken",
  "authorization",
  "Authorization",
  "password",
  "senha",
]);

export function sanitizeSerasaPayload(
  args: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}
