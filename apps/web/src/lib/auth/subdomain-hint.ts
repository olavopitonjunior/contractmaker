/**
 * Fonte ÚNICA da regra "quando confiar no x-org-subdomain pra resolver a org".
 * Usada pelos DOIS caminhos de leitura do header — os wrappers de auth
 * (requireAuth/requireApiAuth via `sessionSubdomainHint`) e o path bare de
 * getUserOrg (via `readRequestSubdomainHint` em user-org.ts) — pra não
 * divergirem. Divergência reintroduz split-brain / forge.
 *
 * O x-org-subdomain é um conceito de SESSÃO (UI humana num subdomínio de tenant)
 * e só é confiável se o middleware o sanitizou (delete + re-set). Fora do matcher
 * do middleware o header não é tocado → seria forjável, então NÃO é confiado lá.
 */

/**
 * Prefixos de rota EXCLUÍDOS do matcher do middleware (ver middleware.ts::config)
 * onde o x-org-subdomain NÃO é sanitizado. Precisa espelhar o matcher — se um
 * novo prefixo for excluído lá, some aqui. `/api/auth` é a única superfície de
 * SESSÃO fora do matcher hoje (permissions, reset-password); os demais (`/f`,
 * `/p`, `/api/forms`) são públicos/anônimos mas listados por robustez, caso um
 * getUserOrg de sessão seja adicionado neles no futuro.
 */
const UNSANITIZED_PREFIXES = ["/api/auth", "/api/forms", "/f/", "/p/"] as const;

/** true quando o middleware roda na rota (e portanto sanitizou o header). */
export function isMiddlewareSanitizedPath(pathname: string): boolean {
  return !UNSANITIZED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p)
  );
}

/**
 * Hint pra resolução de org na superfície de SESSÃO. Regras:
 *  - Máquina (bearer/newton, viaSession=false): null — a org vem do dono do
 *    token, não de um Host controlável pelo cliente.
 *  - Rota fora do matcher (header não sanitizado): null — seria forjável.
 *  - Sessão em rota sanitizada: o header (já limpo pelo middleware).
 */
export function sessionSubdomainHint(
  req: Request,
  viaSession: boolean
): string | null {
  if (!viaSession) return null;
  let path: string;
  try {
    path = new URL(req.url).pathname;
  } catch {
    return null;
  }
  if (!isMiddlewareSanitizedPath(path)) return null;
  return req.headers.get("x-org-subdomain");
}
