import crypto from "crypto";

/**
 * ETag helpers para detecção de concorrência (PRD §6.6 e agents.md §6).
 *
 * Estratégia adotada:
 *  - ETag fraco baseado em (updatedAt, version) do recurso. Não usa hash
 *    completo do payload — desnecessário e custoso.
 *  - Cliente Newton mantém ETag local e envia em `If-Match` no PATCH/PUT.
 *  - Servidor compara antes de aplicar; mismatch retorna 412 Precondition
 *    Failed (cliente decide re-ler ou pedir confirmação ao usuário).
 *
 * Uso típico em handler:
 *
 *   // GET
 *   const etag = etagFor(resource);
 *   return NextResponse.json(resource, { headers: { ETag: etag } });
 *
 *   // PATCH
 *   const ifMatch = req.headers.get("if-match");
 *   const current = etagFor(resource);
 *   if (ifMatch && ifMatch !== current) {
 *     return NextResponse.json(
 *       { error: "Precondition Failed", currentEtag: current },
 *       { status: 412 }
 *     );
 *   }
 *   // ... aplicar mudança
 */

export interface EtagSource {
  updatedAt: Date | string;
  version?: number | null;
}

export function etagFor(source: EtagSource): string {
  const updatedAt =
    source.updatedAt instanceof Date
      ? source.updatedAt.toISOString()
      : source.updatedAt;
  const version = source.version ?? 0;
  // Fingerprint estável: hash sha256 truncado para 16 hex chars.
  const hash = crypto
    .createHash("sha256")
    .update(`${updatedAt}|${version}`)
    .digest("hex")
    .slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * Verifica `If-Match` header. Retorna true se cliente passou If-Match e
 * NÃO bate (precondition failed).
 *
 * Se cliente não passou If-Match, retorna false (sem detecção de concorrência —
 * cliente abriu mão).
 */
export function ifMatchFails(req: Request, currentEtag: string): boolean {
  const ifMatch = req.headers.get("if-match");
  if (!ifMatch) return false;
  // Comparação literal — ETag fraco usa formato `W/"hash"` consistentemente.
  return ifMatch !== currentEtag;
}

/**
 * Anexa header ETag a uma resposta JSON existente.
 */
export function withEtag<T>(
  response: T,
  etag: string,
  init?: ResponseInit
): { body: T; init: ResponseInit } {
  const headers = new Headers(init?.headers);
  headers.set("ETag", etag);
  return {
    body: response,
    init: { ...init, headers },
  };
}
