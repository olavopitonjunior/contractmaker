import { NextResponse } from "next/server";
import { getUserOrg } from "./auth";
import { authOrBearer, hasScope, type ResolvedAuth } from "./auth-or-bearer";
import { resolveNewtonActor, isRejection, type NewtonActorContext } from "@/lib/audit/newton";
import { prisma } from "@/lib/db/prisma";
import { RateLimits } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";

/**
 * Delegação Bearer via `X-Act-As-User`: permite que um Bearer com scope
 * `users:delegate` opere como se fosse outro usuário da MESMA org. Backend
 * passa a aplicar filtros sales-role contra o user delegado, em vez do dono
 * do token (Newton agent user).
 *
 * Gated por `DELEGATION_ENABLED=true` no env. Default false → header ignorado
 * → comportamento idêntico ao atual (rollback é uma var).
 *
 * Distinto do `X-Newton-Actor` existente: este só TAG audit ("essa req é do
 * Newton"); aquele MUDA quem é o ator efetivo da query.
 */
const DELEGATION_SCOPE = "users:delegate";
const DELEGATION_HEADER = "x-act-as-user";

function delegationEnabled(): boolean {
  // .trim() defende contra env value setado com newline final via CLI
  // (`vercel env add` lê stdin com \n e salva literal). 2026-05-17 esse bug
  // causou flag inerte por 30min em prod.
  return (process.env.DELEGATION_ENABLED ?? "").trim() === "true";
}

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
  /**
   * Quando `X-Act-As-User` foi honrado, este campo guarda o `userId` do dono
   * do token (Newton agent), separado do `userId` que é o user delegado.
   * Usado em audit logs e em handlers que precisem distinguir "quem foi" vs
   * "como quem está agindo". `undefined` quando não há delegação ativa.
   */
  delegatedFromUserId?: string;
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

  // Delegação Bearer (X-Act-As-User). Atrás do flag DELEGATION_ENABLED.
  // Substitui `actor.effectiveUserId` pelo target se: bearer + scope + same org.
  let delegatedFromUserId: string | undefined;
  let effectiveActor: NewtonActorContext = actor;
  if (delegationEnabled() && ident.via === "bearer") {
    const actAsHeader = req.headers.get(DELEGATION_HEADER);
    if (actAsHeader) {
      if (!hasScope(ident, DELEGATION_SCOPE)) {
        // Header presente mas sem scope: warn + ignora (não 403).
        // Evita quebrar outros bearers que mandem o header acidentalmente.
        console.warn(
          `[delegation] X-Act-As-User present but token ${ident.tokenId} lacks scope ${DELEGATION_SCOPE}`
        );
      } else {
        // Resolve org do dono do token (pra validar mesma org)
        const tokenOwnerOrg = await getUserOrg(ident.userId);
        if (!tokenOwnerOrg) {
          return {
            ok: false,
            response: NextResponse.json(
              { error: "Forbidden", reason: "token owner has no org" },
              { status: 403 }
            ),
          };
        }
        // OrgMembership não tem `status` — membership existir = ativo.
        const target = await prisma.user
          .findFirst({
            where: {
              id: actAsHeader,
              orgMemberships: { some: { orgId: tokenOwnerOrg.id } },
            },
            select: { id: true },
          })
          .catch(() => null);
        if (!target) {
          // Audit a tentativa de delegação cross-org / target inexistente
          audit(
            {
              orgId: tokenOwnerOrg.id,
              userId: ident.userId,
              ipAddress: extractIpAddress(req),
              userAgent: req.headers.get("user-agent"),
            },
            {
              action: "DELEGATION_REJECTED",
              result: "DENIED",
              metadata: {
                via: "newton",
                tokenId: ident.tokenId,
                requestedTarget: actAsHeader,
                reason: "target_not_in_token_org",
              },
            }
          );
          return {
            ok: false,
            response: NextResponse.json(
              { error: "Forbidden", reason: "delegate target not in token's org" },
              { status: 403 }
            ),
          };
        }
        // OK: switch effective actor
        delegatedFromUserId = ident.userId;
        effectiveActor = { ...actor, effectiveUserId: target.id };
        // Fire-and-forget audit (não bloqueia request)
        audit(
          {
            orgId: tokenOwnerOrg.id,
            userId: ident.userId,
            ipAddress: extractIpAddress(req),
            userAgent: req.headers.get("user-agent"),
          },
          {
            action: "DELEGATION_ASSUMED",
            result: "SUCCESS",
            metadata: {
              via: "newton",
              tokenId: ident.tokenId,
              delegatedTo: target.id,
            },
          }
        );
      }
    }
  }

  const org = await getUserOrg(effectiveActor.effectiveUserId);
  if (!org) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No organization" },
        { status: 400 }
      ),
    };
  }

  // Heartbeat de acesso (só UI humana via session). Mantém OrgMembership.lastActiveAt
  // fresco para alimentar "último acesso" e limpar o label "convite pendente". O WHERE
  // condicional faz o throttle (escreve no máx. ~1x/5min por membro), sem leitura extra.
  // Fire-and-forget: roda antes do handler responder, então não sofre o cancelamento
  // pós-response do Vercel.
  if (ident.via === "session") {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    prisma.orgMembership
      .updateMany({
        where: {
          userId: effectiveActor.effectiveUserId,
          orgId: org.id,
          OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: fiveMinAgo } }],
        },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => {});
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
        where: { id: effectiveActor.effectiveUserId },
        select: { email: true, name: true },
      })
      .catch(() => null);
    userEmail = u?.email ?? "";
    userName =
      u?.name ?? u?.email ?? `Newton (${effectiveActor.effectiveUserId.slice(0, 8)})`;
  }

  return {
    ok: true,
    ctx: {
      userId: effectiveActor.effectiveUserId,
      userEmail,
      userName,
      orgId: org.id,
      orgName: org.name,
      ipAddress: extractIpAddress(req),
      userAgent: req.headers.get("user-agent"),
      via: ident.via,
      actor: effectiveActor,
      delegatedFromUserId,
    },
  };
}
