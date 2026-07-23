/**
 * Fonte ÚNICA da regra "quando confiar no x-org-subdomain pra resolver a org".
 * Usada por requireAuth (context.ts) e requireApiAuth (require-auth.ts) pra não
 * divergirem — divergência entre wrappers reintroduz split-brain.
 *
 * O x-org-subdomain é um conceito de SESSÃO (UI humana num subdomínio de tenant),
 * e só é confiável se o middleware o sanitizou (delete + re-set). Regras:
 *
 *  - **Máquina (bearer/newton):** null. A org vem do dono do token, não de um
 *    Host que o cliente controla — senão apontar a integração pra um subdomínio
 *    steer-aria o orgId de todo o escopo de dados/audit.
 *  - **Rota FORA do matcher do middleware (`/api/auth/*`):** null. O middleware
 *    não roda lá, então o header não é sanitizado e um valor forjado sobreviveria.
 *  - **Sessão em rota sanitizada:** o header (já limpo pelo middleware).
 *
 * (Requests bearer nem recebem o header — o middleware não o injeta quando há
 * `Authorization: Bearer` — mas pinamos aqui também como defesa pras rotas fora
 * do matcher, onde o middleware não roda.)
 */
export function sessionSubdomainHint(
  req: Request,
  viaSession: boolean
): string | null {
  if (!viaSession) return null;
  // Rotas excluídas do matcher do middleware (middleware.ts) não têm o header
  // sanitizado. `/api/auth/*` é a única superfície de SESSÃO fora do matcher.
  let path: string;
  try {
    path = new URL(req.url).pathname;
  } catch {
    return null;
  }
  if (path.startsWith("/api/auth")) return null;
  return req.headers.get("x-org-subdomain");
}
