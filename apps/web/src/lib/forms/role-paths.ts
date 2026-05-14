import type { ParticipantRole } from "./participant-token";

/**
 * Allowlist de chaves top-level de `DadosContratoForm` que cada role pode
 * ler e escrever. Usado por:
 *
 *   - GET `/api/forms/participant/[subtoken]` — server pica `dataJson`
 *     pra mandar só o que o role enxerga.
 *   - PATCH `/api/forms/participant/[subtoken]` — server chama
 *     `deepMergeAtPaths(current, incoming, ROLE_PATHS[role])`.
 *   - `useAutoSave({ pathScope: ROLE_PATHS[role] })` no cliente.
 *
 * Decisão: vendedor preenche `imoveis` (é quem tem matrícula/IPTU em mãos).
 * Comprador só preenche `compradores`. Campos comerciais (`pagamento`,
 * `comissao`, `config`, `assinatura`, `testemunhas`) ficam EXCLUSIVOS do
 * admin (token principal) — comprador não negocia comissão.
 */
export const ROLE_PATHS: Record<ParticipantRole, readonly string[]> = {
  vendedor: ["vendedores", "imoveis"],
  comprador: ["compradores"],
};

/**
 * Filtra `dataJson` mantendo só as chaves permitidas pro role. Usado na
 * leitura via subtoken pra garantir que o cliente não recebe dados da
 * outra parte mesmo via inspeção do payload.
 */
export function filterDataJsonByRole(
  dataJson: Record<string, unknown>,
  role: ParticipantRole,
): Record<string, unknown> {
  const allow = new Set(ROLE_PATHS[role]);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(dataJson)) {
    if (allow.has(key)) out[key] = dataJson[key];
  }
  return out;
}
