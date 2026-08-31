import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getUserOrg } from "./auth";
import { getImpersonationFor } from "./impersonation";
import { sessionSubdomainHint } from "./subdomain-hint";
import { authOrBearer, hasScope, type ResolvedAuth } from "./auth-or-bearer";
import { resolveNewtonActor, isRejection, type NewtonActorContext } from "@/lib/audit/newton";
import { prisma } from "@/lib/db/prisma";
import { RateLimits } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";
import { getEffectivePermissions } from "@/lib/security/rbac/check";
import { checkDelegationTarget } from "@/lib/security/rbac/delegation";

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
  /**
   * Quando o super_admin está operando um tenant via "trocar de tenant"
   * (impersonation), guarda o userId REAL do admin. `userId` nesse caso é o dono
   * do tenant — é ele que resolve membership/RBAC/escopo. `undefined` fora de
   * impersonation.
   */
  impersonatedByUserId?: string;
  /**
   * E-mail do admin REAL sob impersonation — par de `impersonatedByUserId`.
   * `userEmail` nesse caso é o do dono do tenant, então gates de PLATAFORMA
   * (que comparam e-mail contra allowlist de env, não contra membership) leem
   * daqui. Sem query extra: impersonation só existe para `via === "session"`,
   * e nesse ramo `ident.email` já é o do admin. `undefined` fora dela.
   */
  impersonatedByEmail?: string;
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

  // Bearer só entra em rota que declara scope explícito. Sem isso, qualquer
  // token válido da org acessava toda rota `requireAuth(req)` sem scope
  // (financeiro, dimob, dual-approvals...) — superfície M2M implícita muito
  // maior que a documentada no OpenAPI. Rotas destinadas a agentes declaram
  // `{ scope }`; as demais ficam session-only por default.
  if (ident.via === "bearer" && !opts.scope) {
    // waitUntil (não `void promise()`): audit de negação de segurança precisa
    // sobreviver ao envio da response — Vercel cancela promises soltas.
    waitUntil(
      (async () => {
        // findFirst pega uma membership arbitrária se o dono do token for
        // multi-org (tokens de agente são de bot single-org hoje; se isso
        // mudar, resolver org pelo token, não pela 1ª membership).
        const membership = await prisma.orgMembership
          .findFirst({ where: { userId: ident.userId }, select: { orgId: true } })
          .catch(() => null);
        if (!membership) return;
        await audit(
          {
            orgId: membership.orgId,
            userId: ident.userId,
            ipAddress: extractIpAddress(req),
            userAgent: req.headers.get("user-agent"),
          },
          {
            action: "API_TOKEN_AUTH_FAILED",
            result: "DENIED",
            metadata: {
              via: "newton",
              tokenId: ident.tokenId,
              reason: "bearer_on_unscoped_route",
              path: new URL(req.url).pathname,
            },
          }
        );
      })()
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Forbidden",
          reason: "bearer tokens require a scoped endpoint (session-only route)",
        },
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
  // Org efetiva quando há delegação: a org VALIDADA do dono do token (na qual o
  // target também é membro), NÃO a 1ª membership do target — senão um target
  // multi-org escalaria pra uma org onde o dono do token nem entrou.
  let delegationOrg: Awaited<ReturnType<typeof getUserOrg>> = null;
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
        // Resolve org do dono do token (pra validar mesma org). subdomainHint:null
        // DE PROPÓSITO: é máquina (bearer) — a org vem do token, não do Host, que
        // um cliente controla. Sem o pin, apontar pra um subdomínio mudaria a org
        // validada ou daria 403 falso.
        const tokenOwnerOrg = await getUserOrg(ident.userId, { subdomainHint: null });
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
        // Mesma org NÃO basta: isso diz ONDE a delegação vale, não QUEM ela
        // pode virar. Sem a trava abaixo, um token de serviço com
        // `users:delegate` aponta pro `owner` do tenant e age com o poder
        // dele — e o token de serviço existe justamente pra ter MENOS poder
        // que gente.
        const [ownerPerms, targetPerms] = await Promise.all([
          getEffectivePermissions(ident.userId, tokenOwnerOrg.id).catch(() => null),
          getEffectivePermissions(target.id, tokenOwnerOrg.id).catch(() => null),
        ]);
        const verdict = checkDelegationTarget(ownerPerms, targetPerms);
        if (!verdict.allowed) {
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
                reason: "target_role_escalation",
                detail: verdict.reason,
                escalatedPermissions: verdict.escalatedPermissions,
              },
            }
          );
          return {
            ok: false,
            response: NextResponse.json(
              // A resposta não enumera as permissões: quem chama é máquina e
              // não age sobre isso, e a lista descreveria o RBAC do tenant pra
              // quem já está tentando escalar. O detalhe fica no audit.
              { error: "Forbidden", reason: "delegate target outranks token owner" },
              { status: 403 }
            ),
          };
        }

        // OK: switch effective actor. A org efetiva é a do dono do token
        // (validada acima), não a resolução independente do target.
        delegatedFromUserId = ident.userId;
        effectiveActor = { ...actor, effectiveUserId: target.id };
        delegationOrg = tokenOwnerOrg;
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

  // Impersonation de tenant ("trocar de tenant" do super_admin). SÓ sessão web:
  // bearer é máquina e a org vem do token, não de um cookie. O ator efetivo passa
  // a ser o DONO do tenant — sem isso o admin entrava na org mas não tinha
  // membership nela, e todo `requirePermission`/`can()` negava (403). O admin real
  // fica em `impersonatedByUserId` e é carimbado em todo AuditLog (ver audit.ts).
  const imp =
    ident.via === "session" ? await getImpersonationFor(ident.userId) : null;
  let impersonatedByUserId: string | undefined;
  let impersonatedByEmail: string | undefined;
  if (imp) {
    impersonatedByUserId = ident.userId;
    // `ident` continua sendo a identidade do admin real — `imp` é derivado dela
    // (getImpersonationFor(ident.userId)), e impersonation só existe no ramo
    // session, onde `ident.email` está preenchido. Guardar aqui evita o lookup
    // que `userEmail` faz logo abaixo, que resolve o DONO do tenant.
    //
    // O `ident.via === "session"` NÃO é redundante apesar de `imp` só existir
    // nesse ramo: `ResolvedAuth` é união discriminada e o ramo `bearer` não tem
    // `email`, então sem a checagem o tsc reprova. Não "simplificar".
    impersonatedByEmail = ident.via === "session" ? (ident.email ?? undefined) : undefined;
    effectiveActor = { ...effectiveActor, effectiveUserId: imp.ownerUserId };
  }

  // Delegação → org validada do dono do token. Impersonation → a org impersonada
  // (explícita, não a 1ª membership do dono, que pode ser multi-org). Senão,
  // resolve pela regra única sessionSubdomainHint (sessão em rota sanitizada lê o
  // subdomínio; máquina e rotas fora do matcher pinam token-based) — mesma regra
  // do require-auth.ts.
  const org = delegationOrg
    ? delegationOrg
    : imp
      ? await prisma.organization.findUnique({ where: { id: imp.orgId } })
      : await getUserOrg(effectiveActor.effectiveUserId, {
          subdomainHint: sessionSubdomainHint(req, ident.via === "session"),
        });
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
  // `!imp`: sob impersonation o "último acesso" é do admin, não do dono do
  // tenant — carimbar a membership dele mentiria no painel de membros.
  if (ident.via === "session" && !imp) {
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
  if (ident.via === "session" && !imp) {
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
      u?.name ??
      u?.email ??
      (imp
        ? `Dono do tenant (${effectiveActor.effectiveUserId.slice(0, 8)})`
        : `Newton (${effectiveActor.effectiveUserId.slice(0, 8)})`);
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
      impersonatedByUserId,
      impersonatedByEmail,
    },
  };
}
