import { NextResponse } from "next/server";
import { getUserOrg } from "./auth";
import { authOrBearer, hasScope, type ResolvedAuth } from "./auth-or-bearer";
import { resolveNewtonActor, isRejection, type NewtonActorContext } from "@/lib/audit/newton";
import { prisma } from "@/lib/db/prisma";
import { RateLimits } from "@/lib/security/ratelimit";

/**
 * Contexto unificado de auth para route handlers. Após a integração Newton:
 *
 *  - `via` indica session (UI web) ou bearer (Newton/cliente externo).
 *  - `actor` carrega `via=newton` para enriquecer AuditLog quando bearer.
 *  - Para bearer, `userEmail`/`userName` vêm de lookup oportunístico em
 *    `prisma.user` para preservar compatibilidade com callers que renderizam
 *    nome/email em logs e mensagens.
 */
export interface AuthContext {
  userId: string;
  userEmail: string;
  userName: string;
  orgId: string;
  orgName: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** "session" para auth via NextAuth cookie; "bearer" para UserApiToken. */
  via: ResolvedAuth["via"];
  /** Actor para audit metadata (.via=newton quando bearer). */
  actor: NewtonActorContext;
}

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: NextResponse };

export interface RequireAuthOptions {
  /** Escopo Bearer obrigatório. Session sempre passa. */
  scope?: string;
}

function extractIpAddress(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

export async function requireAuth(
  req: Request,
  opts: RequireAuthOptions = {}
): Promise<AuthResult> {
  const ident = await authOrBearer(req);
  if (!ident) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (opts.scope && !hasScope(ident, opts.scope)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden", reason: `missing scope ${opts.scope}` },
        { status: 403 }
      ),
    };
  }

  // Rate limit per-token (bearer) ou per-session (UI). Sliding window por scope.
  const rl =
    ident.via === "bearer"
      ? await RateLimits.apiPerToken(ident.tokenId, opts.scope ?? "default")
      : await RateLimits.apiPerSession(ident.userId);
  if (!rl.success) {
    const retryAfterMs = Math.max(0, rl.reset - Date.now());
    return {
      ok: false,
      response: new NextResponse(
        JSON.stringify({
          error: "RATE_LIMITED",
          reason: `limite de ${rl.limit} req/min atingido para este token/scope`,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
            "X-RateLimit-Limit": String(rl.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(rl.reset),
          },
        }
      ),
    };
  }

  const actor = resolveNewtonActor(req, ident);
  if (isRejection(actor)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden", reason: actor.reason },
        { status: 403 }
      ),
    };
  }

  const org = await getUserOrg(actor.effectiveUserId);
  if (!org) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No organization" },
        { status: 400 }
      ),
    };
  }

  // Email/name: para session vêm direto do ident; para bearer fazemos lookup
  // leve (1 query) para preservar compatibilidade com callers que usam nome.
  let userEmail = "";
  let userName = "Usuário";
  if (ident.via === "session") {
    userEmail = ident.email ?? "";
    userName = userEmail || "Usuário";
  } else {
    const u = await prisma.user
      .findUnique({
        where: { id: actor.effectiveUserId },
        select: { email: true, name: true },
      })
      .catch(() => null);
    userEmail = u?.email ?? "";
    userName = u?.name ?? u?.email ?? `Newton (${actor.effectiveUserId.slice(0, 8)})`;
  }

  return {
    ok: true,
    ctx: {
      userId: actor.effectiveUserId,
      userEmail,
      userName,
      orgId: org.id,
      orgName: org.name,
      ipAddress: extractIpAddress(req),
      userAgent: req.headers.get("user-agent"),
      via: ident.via,
      actor,
    },
  };
}
