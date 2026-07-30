/**
 * Tradução de erro de credencial do Google para mensagem acionável.
 *
 * O erro cru que a API devolve quando o refresh token morreu é
 * `invalid_grant` (às vezes com "Token has been expired or revoked."). Isso não
 * diz nada pra quem está na tela — e acontece com frequência: em projetos OAuth
 * em modo "Testing" o refresh token expira a cada 7 dias, então staging quebra
 * sozinho toda semana. A ação certa é sempre a mesma (reconectar a conta), e é
 * ela que a mensagem tem que dizer.
 */
export const GOOGLE_REAUTH_MESSAGE =
  "Conexão Google expirada — reconecte em Configurações → Integrações";

/**
 * `true` quando o erro é de CREDENCIAL (token revogado/expirado, cliente não
 * autorizado, 401), não de conteúdo (doc apagado, permissão do arquivo, quota).
 */
export function isGoogleAuthError(err: unknown): boolean {
  const e = err as {
    message?: string;
    code?: number | string;
    status?: number;
    response?: { status?: number; data?: { error?: string } };
  } | null;
  if (!e) return false;

  const respError = e.response?.data?.error;
  if (respError === "invalid_grant" || respError === "unauthorized_client") return true;

  const status = e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
  if (status === 401) return true;

  const msg = typeof e.message === "string" ? e.message : typeof err === "string" ? err : "";
  return /invalid_grant|unauthorized_client|invalid_client|token has been expired or revoked/i.test(
    msg
  );
}

/**
 * Mensagem pra UI: a acionável quando é problema de credencial, o texto cru
 * (que ainda ajuda no suporte) caso contrário.
 */
export function googleErrorMessage(err: unknown): string {
  if (isGoogleAuthError(err)) return GOOGLE_REAUTH_MESSAGE;
  return err instanceof Error ? err.message : String(err);
}
