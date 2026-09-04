import { cache as reactCache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getPlatformRole } from "@/lib/security/rbac/platform";

// `React.cache` deduplica por request no runtime do Next. Fora dele (ex.: vitest
// com react stable que não exporta `cache`), degrada pra identidade — sem
// memoização, comportamento correto. Espelha lib/modules/read.ts.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === "function" ? reactCache : (fn) => fn;

/**
 * Consumo da impersonation de tenant (super_admin "testar como" o dono de uma org).
 *
 * A rota /api/admin/orgs/[orgId]/impersonate já grava o cookie `mt_impersonate=<orgId>`
 * + uma row `TenantImpersonationSession`. Este módulo é o SEAM que efetivamente
 * aplica o overlay de identidade: `getUserOrg` (resolução de org) e as rotas do
 * fluxo de teste trocam o id cru pelo id EFETIVO (o owner da org) quando há uma
 * impersonation ativa e válida.
 *
 * Princípios:
 *  - `auth()` NÃO é sobreposto — o `userId` que chega aqui é sempre o super_admin
 *    real. Por isso validamos contra o próprio `userId` (sem chamar auth() →
 *    sem dependência circular com auth.ts).
 *  - Node-only (usa prisma + next/headers). `getUserOrg` nunca roda no edge.
 *  - Path-guard: superfícies de plataforma/segurança/auth NUNCA sofrem overlay.
 *  - Alvo é sempre o OWNER da org (não um id arbitrário) → sem escalonar fora da org.
 */

export const IMPERSONATION_COOKIE = "mt_impersonate";

/**
 * TTL da sessão de impersonation. 8h = um dia de trabalho: o switcher de tenant
 * é ferramenta de operação diária (não só de suporte pontual), e expirar no meio
 * do expediente derrubava o admin pro tenant de origem sem aviso.
 */
export const IMPERSONATION_TTL_SECONDS = 8 * 60 * 60;

// Superfícies que SEMPRE enxergam o usuário cru (nunca o overlay):
// painel de plataforma, ações de segurança da própria conta (perfil/senha em
// /api/me, 2FA/elevação/trusted-devices em /api/security), e o fluxo de auth.
// Sem isso, o super_admin não conseguiria encerrar a impersonation nem operar o /admin.
// Defense-in-depth: as escritas de credencial já chaveiam no session.user.id cru,
// mas o guard evita que o orgId (e futuras rotas) sejam sobrepostos indevidamente.
const RAW_PATH_PREFIXES = ["/admin", "/api/admin", "/api/me", "/api/security", "/api/auth"] as const;

export interface ImpersonationContext {
  orgId: string;
  ownerUserId: string;
  /** Quando a sessão de impersonation vence (TTL) — o banner mostra e vigia. */
  endsAt: Date;
}

/**
 * orgId da impersonation candidata do request atual — cookie + path-guard, SEM
 * validar PlatformRole/sessão (isso é do caller). Retorna null fora de request
 * scope (cron/script) ou numa superfície crua.
 */
function readImpersonationCookie(): string | null {
  let orgId: string | undefined;
  let pathname = "";
  try {
    orgId = cookies().get(IMPERSONATION_COOKIE)?.value;
    pathname = headers().get("x-pathname") ?? "";
  } catch {
    return null;
  }
  if (!orgId) return null;
  // Path-guard: superfícies cruas (plataforma/segurança/auth) nunca sofrem overlay.
  if (RAW_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null;
  }
  return orgId;
}

/**
 * Impersonation ATIVA para o usuário candidato (o super_admin real), ou null.
 * Cacheado por request (React.cache) por userId — 1 validação por request.
 */
export const getImpersonationFor = cache(
  async (userId: string): Promise<ImpersonationContext | null> => {
    // Early-out barato no caminho quente: sem cookie, nada a fazer.
    // cookies()/headers() lançam fora de um request (cron/script) → sem overlay.
    const orgId = readImpersonationCookie();
    if (!orgId) return null;

    // Só super_admin impersona — revalidado a cada request (cookie sozinho não basta).
    const pr = await getPlatformRole(userId);
    if (pr?.role !== "super_admin") return null;

    // Sessão de impersonation ativa (respeita o TTL de endsAt).
    const active = await prisma.tenantImpersonationSession.findFirst({
      where: { adminUserId: userId, orgId, endedAt: null, endsAt: { gt: new Date() } },
      select: { id: true, endsAt: true },
    });
    if (!active) return null;

    // Alvo = owner da org (membro por definição → membership/permissões resolvem).
    const owner = await prisma.orgMembership.findFirst({
      where: { orgId, role: "owner" },
      select: { userId: true },
    });
    if (!owner) return null;

    return { orgId, ownerUserId: owner.userId, endsAt: active.endsAt };
  }
);

/** true quando há impersonation ativa para o usuário. */
export async function isImpersonating(userId: string): Promise<boolean> {
  return (await getImpersonationFor(userId)) !== null;
}

/** Id EFETIVO: o owner impersonado quando ativo; senão o próprio userId. */
export async function getEffectiveUserId(userId: string): Promise<string> {
  const imp = await getImpersonationFor(userId);
  return imp ? imp.ownerUserId : userId;
}

/**
 * Metadados da impersonation ativa no request atual, PARA AUDITORIA — resolvidos
 * só a partir do cookie, sem receber userId.
 *
 * Existe porque `audit()` grava `userId` = ator EFETIVO (o dono do tenant, desde
 * que a identidade passou a ser sobreposta em requireAuth). Sem este carimbo, uma
 * ação do super_admin dentro de um tenant ficaria indistinguível de uma ação do
 * próprio dono. Com ele, todo AuditLog escrito sob impersonation leva
 * `metadata.impersonatedBy` = userId real do admin + o id da sessão.
 *
 * Cacheado por request. Custo zero no caminho comum (sem cookie → 1 leitura).
 */
export const getImpersonationAuditMeta = cache(
  async (): Promise<{ orgId: string; adminUserId: string; sessionId: string } | null> => {
    const orgId = readImpersonationCookie();
    if (!orgId) return null;
    // Sessão ativa mais recente da org. Não filtra por adminUserId (o audit não
    // sabe quem é o admin) — na prática o staff é minúsculo e a sessão é 1:1 com
    // o cookie que acabou de ser lido.
    const active = await prisma.tenantImpersonationSession
      .findFirst({
        where: { orgId, endedAt: null, endsAt: { gt: new Date() } },
        orderBy: { startedAt: "desc" },
        select: { id: true, adminUserId: true },
      })
      .catch(() => null);
    if (!active) return null;
    return { orgId, adminUserId: active.adminUserId, sessionId: active.id };
  }
);
