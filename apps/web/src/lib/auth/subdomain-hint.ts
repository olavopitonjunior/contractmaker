/**
 * Fonte ÚNICA da regra "quando confiar no x-org-subdomain pra resolver a org".
 * Usada pelos DOIS caminhos de leitura do header — os wrappers de auth
 * (requireAuth/requireApiAuth via `sessionSubdomainHint`) e o path bare de
 * getUserOrg (via `readRequestSubdomainHint` em user-org.ts) — pra não
 * divergirem. Divergência reintroduz split-brain / forge.
 *
 * SINAL DE SANITIZAÇÃO = presença do header `x-pathname`. O middleware o seta em
 * TODA rota do seu matcher (middleware.ts::config), então sua presença prova que
 * o middleware rodou e sanitizou o x-org-subdomain (delete + re-set). Ausente =
 * rota FORA do matcher → o header não foi tocado → NÃO é confiável (forjável).
 * Usar a presença do x-pathname (e não uma lista de prefixos) evita ter que
 * espelhar o regex do matcher — uma lista de prefixos erra fácil (ex.: excluir
 * `/api/forms` inteiro derruba `/api/forms/[token]/lock`, que É rota do matcher).
 */

const AUTH_PREFIX = "/api/auth";

/**
 * Hint pra resolução de org na superfície de SESSÃO. Regras:
 *  - Máquina (bearer/newton, viaSession=false): null — a org vem do dono do
 *    token, não de um Host controlável pelo cliente.
 *  - Rota fora do matcher (sem x-pathname → header não sanitizado): null.
 *  - `/api/auth/*`: null. É a única superfície de SESSÃO fora do matcher
 *    (permissions, reset-password); guarda reliable (via req.url) caso um
 *    x-pathname forjado tente burlar o check de presença.
 *  - Sessão em rota sanitizada: o header (já limpo pelo middleware).
 */
export function sessionSubdomainHint(
  req: Request,
  viaSession: boolean
): string | null {
  if (!viaSession) return null;
  // Middleware rodou? (x-pathname presente ⟺ rota do matcher ⟺ sanitizada)
  if (req.headers.get("x-pathname") == null) return null;
  try {
    if (new URL(req.url).pathname.startsWith(AUTH_PREFIX)) return null;
  } catch {
    return null;
  }
  return req.headers.get("x-org-subdomain");
}
