import { NextResponse } from "next/server";
import { authOrBearer, hasScope, type ResolvedAuth } from "@/lib/auth/auth-or-bearer";
import { getUserOrg } from "@/lib/auth/auth";
import {
  resolveNewtonActor,
  isRejection,
  type NewtonActorContext,
} from "@/lib/audit/newton";
import {
  audit,
  extractAuditContextFromRequest,
} from "@/lib/security/audit";
import { RateLimits } from "@/lib/security/ratelimit";

/**
 * Wrapper unificado para route handlers que precisam autenticar.
 *
 * Substitui o trio padrão `auth()` + `getUserOrg()` + cross-org check por
 * uma chamada única que:
 *
 *  1. Resolve identidade via `authOrBearer` (session OU Bearer token).
 *  2. Verifica escopo Bearer se exigido.
 *  3. Resolve Newton actor (rejeita spoofing de header X-Newton-Actor).
 *  4. Carrega org do usuário.
 *
 * Pattern de uso:
 *
 *   export async function POST(req: NextRequest) {
 *     const auth = await requireApiAuth(req, { scope: "deals:rw" });
 *     if (isAuthFailure(auth)) return authFailureResponse(auth);
 *     // auth.ident, auth.actor, auth.org agora disponíveis
 *     ...
 *   }
 *
 * Compare com o pattern antigo de 3 blocos (auth/org/forbidden) para diff
 * pequeno em retrofit.
 */

export interface ApiAuthSuccess {
  ident: ResolvedAuth;
  actor: NewtonActorContext;
  org: { id: string };
}

export interface ApiAuthFailure {
  error: "Unauthorized" | "Forbidden" | "Bad Request" | "RATE_LIMITED";
  reason?: string;
  status: 400 | 401 | 403 | 429;
  /** Segundos pra próxima tentativa (RATE_LIMITED). */
  retryAfter?: number;
  rateLimit?: { limit: number; remaining: number; reset: number };
}

export interface RequireAuthOptions {
  /**
   * Escopo Bearer obrigatório. Quando session-auth, escopo é considerado
   * presente automaticamente (UI = poder total).
   */
  scope?: string;
  /**
   * Se true, retorna `Forbidden` quando user não tem org. Default true.
   */
  requireOrg?: boolean;
  /**
   * Pular rate-limit. Útil em endpoints de cron ou internal. Default false.
   */
  skipRateLimit?: boolean;
}

export async function requireApiAuth(
  req: Request,
  opts: RequireAuthOptions = {}
): Promise<ApiAuthSuccess | ApiAuthFailure> {
  const ident = await authOrBearer(req);
  if (!ident) {
    return { error: "Unauthorized", status: 401 };
  }

  if (opts.scope && !hasScope(ident, opts.scope)) {
    // Audit best-effort para tentativa Bearer sem escopo. Para session é
    // bypass natural.
    if (ident.via === "bearer") {
      // Não auditamos aqui pois `audit` precisa de orgId que não temos
      // ainda. Deixa para o caller registrar via API_TOKEN_AUTH_FAILED.
    }
    return {
      error: "Forbidden",
      reason: `missing scope ${opts.scope}`,
      status: 403,
    };
  }

  // Rate limit per-token (bearer) / per-session (UI). Pula se opts.skipRateLimit.
  if (!opts.skipRateLimit) {
    const rl =
      ident.via === "bearer"
        ? await RateLimits.apiPerToken(ident.tokenId, opts.scope ?? "default")
        : await RateLimits.apiPerSession(ident.userId);
    if (!rl.success) {
      const retryAfterMs = Math.max(0, rl.reset - Date.now());
      return {
        error: "RATE_LIMITED",
        reason: `limite de ${rl.limit} req/min atingido`,
        status: 429,
        retryAfter: Math.ceil(retryAfterMs / 1000),
        rateLimit: { limit: rl.limit, remaining: 0, reset: rl.reset },
      } as ApiAuthFailure;
    }
  }

  const actorResult = resolveNewtonActor(req, ident);
  if (isRejection(actorResult)) {
    // Spoofing de header — auditar com orgId da request best-effort
    // (org do user dono do token, se bearer; nada se session).
    if (ident.via === "bearer") {
      // subdomainHint:null → org do token (home), não do Host. Sem o pin, um
      // spoof vindo de um subdomínio de que o dono não é membro resolveria null
      // e o audit do spoof seria silenciosamente pulado.
      const userOrg = await getUserOrg(ident.userId, { subdomainHint: null }).catch(
        () => null
      );
      if (userOrg) {
        await audit(
          extractAuditContextFromRequest(req, userOrg.id, ident.userId),
          {
            action: "NEWTON_ACTOR_HEADER_REJECTED",
            result: "DENIED",
            metadata: { reason: actorResult.reason },
          }
        );
      }
    }
    return {
      error: "Forbidden",
      reason: actorResult.reason,
      status: 403,
    };
  }

  const requireOrg = opts.requireOrg ?? true;
  // Sessão (UI humana) → lê o x-org-subdomain (resolve a org do tenant que o
  // usuário está navegando). Bearer/Newton (máquina) → pina token-based: a org
  // vem do dono do token, não de um Host controlável pelo cliente.
  const org = await getUserOrg(
    actorResult.effectiveUserId,
    ident.via === "session" ? undefined : { subdomainHint: null }
  );
  if (!org) {
    if (requireOrg) {
      return {
        error: "Forbidden",
        reason: "user has no active org",
        status: 403,
      };
    }
    // Caller pode lidar com ausência de org se needed
    return {
      ident,
      actor: actorResult,
      org: { id: "" },
    };
  }

  return {
    ident,
    actor: actorResult,
    org: { id: org.id },
  };
}

export function isAuthFailure(
  r: ApiAuthSuccess | ApiAuthFailure
): r is ApiAuthFailure {
  return "error" in r;
}

export function authFailureResponse(f: ApiAuthFailure): NextResponse {
  if (f.status === 429 && f.rateLimit && f.retryAfter != null) {
    return new NextResponse(
      JSON.stringify({ error: f.error, reason: f.reason }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "Retry-After": String(f.retryAfter),
          "X-RateLimit-Limit": String(f.rateLimit.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(f.rateLimit.reset),
        },
      }
    );
  }
  return NextResponse.json(
    { error: f.error, reason: f.reason },
    { status: f.status }
  );
}
