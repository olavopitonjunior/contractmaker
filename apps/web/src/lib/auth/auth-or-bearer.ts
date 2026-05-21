import { auth } from "@/lib/auth/auth";
import { verifyBearerToken, type VerifiedToken } from "@/lib/auth/api-token";

/**
 * Resultado unificado de autenticação. Ambos session-based (NextAuth cookie)
 * e bearer-based (UserApiToken) produzem este shape para que handlers de
 * route não precisem saber qual estratégia foi usada.
 *
 * `via` permite handlers diferenciarem comportamento (ex.: rate-limit por
 * fonte) e injetar `via=newton` em AuditLog quando vier de bearer.
 */
export type ResolvedAuth =
  | {
      via: "session";
      userId: string;
      email: string | null;
    }
  | {
      via: "bearer";
      userId: string;
      tokenId: string;
      scopes: string[];
    };

/**
 * Tenta autenticar a request por Bearer token primeiro; se ausente, cai
 * para session cookie via `auth()` do NextAuth. Retorna `null` se nenhuma
 * estratégia for válida.
 *
 * Uso:
 *   const ident = await authOrBearer(req);
 *   if (!ident) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   const userId = ident.userId;
 */
export async function authOrBearer(
  req: Request
): Promise<ResolvedAuth | null> {
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    const rawToken = header.slice(7).trim();
    if (rawToken.length > 0) {
      const verified = await verifyBearerToken(rawToken);
      if (verified) {
        return {
          via: "bearer",
          userId: verified.userId,
          tokenId: verified.tokenId,
          scopes: verified.scopes,
        };
      }
      // Bearer presente mas inválido: não cai para session — retorna null
      // para evitar confusão (cliente esperava bearer auth).
      return null;
    }
  }

  const session = await auth();
  if (session?.user?.id) {
    return {
      via: "session",
      userId: session.user.id,
      email: session.user.email ?? null,
    };
  }
  return null;
}

/**
 * Verifica se o token autenticado tem o escopo necessário. Para session-based
 * auth (UI web), todos os escopos são considerados presentes — usuário logado
 * tem permissão completa via UI. Para bearer-based, exige escopo explícito.
 *
 * Hierarquia rw⊇r: um scope de leitura (`X:r`) é satisfeito por quem tem o
 * read-write correspondente (`X:rw`). Isso permite que endpoints exijam o scope
 * mínimo (`deals:r`) sem precisar adicionar um scope dedicado ao catálogo nem
 * recriar tokens que já têm `deals:rw`.
 */
export function hasScope(ident: ResolvedAuth, scope: string): boolean {
  if (ident.via === "session") return true;
  if (ident.scopes.includes(scope)) return true;
  // "deals:r" satisfeito por "deals:rw".
  if (scope.endsWith(":r")) {
    return ident.scopes.includes(`${scope}w`);
  }
  return false;
}

export function isBearerAuth(
  ident: ResolvedAuth
): ident is Extract<ResolvedAuth, { via: "bearer" }> {
  return ident.via === "bearer";
}

/**
 * Helper para route que aceita ambas as autenticações. Lança 401 (via
 * NextResponse) implícito — caller deve tratar `null`.
 */
export interface AuthFailureResponse {
  error: "Unauthorized" | "Forbidden";
  reason: string;
  status: 401 | 403;
}

export function unauthorizedResponse(reason = "missing or invalid auth"): AuthFailureResponse {
  return { error: "Unauthorized", reason, status: 401 };
}

export function forbiddenResponse(reason: string): AuthFailureResponse {
  return { error: "Forbidden", reason, status: 403 };
}
