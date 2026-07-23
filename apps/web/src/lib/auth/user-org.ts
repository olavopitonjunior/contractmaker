import { prisma } from "@/lib/db/prisma";
import { getImpersonationFor } from "./impersonation";

/**
 * Resolução da org do usuário autenticado, respeitando o subdomínio de tenant.
 *
 * Fica em módulo próprio (fora de auth.ts, que boota NextAuth no top-level) pra
 * ser testável sem instanciar o NextAuth e pra desacoplar da config de auth.
 * `auth.ts` re-exporta `getUserOrg` — o import path `@/lib/auth/auth` continua
 * válido pros ~196 call-sites.
 */

/**
 * Lê o hint de subdomínio de tenant (`x-org-subdomain`, injetado pelo middleware
 * a partir do host) dos request headers. Import DINÂMICO de `next/headers` de
 * propósito: este módulo é alcançado pelo grafo de imports do `middleware.ts`
 * (edge runtime), onde um import estático de `next/headers` quebraria o bundle.
 * Fora de request scope (script/CLI/init) `headers()` lança → retorna null →
 * `getUserOrg` cai no fallback legado (primeira membership). Seguro.
 */
async function readRequestSubdomainHint(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return headers().get("x-org-subdomain");
  } catch (err) {
    // `headers()` lança DynamicServerError (digest DYNAMIC_SERVER_USAGE) durante
    // o prerender estático pra sinalizar ao Next que a rota tem que ser dinâmica.
    // RE-LANÇAR: engolir mascararia o sinal e poderia deixar a rota prerenderar
    // estática com hint nulo (org resolvida errada e cacheada). Na prática todo
    // caller já chamou auth()→cookies() (já dinâmico), mas não dependemos disso.
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      (err as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE"
    ) {
      throw err;
    }
    // Fora de request scope (script/CLI/init) → sem hint, fallback legado.
    return null;
  }
}

// Resolve a org do usuário respeitando o subdomínio de tenant. Com hint
// (x-org-subdomain via middleware) valida a membership NAQUELE tenant — se o user
// não for membro, retorna null (sem acesso). Sem subdomínio (apex) cai no legado:
// primeira membership.
//
// SWEEP MULTI-ORG: o hint é resolvido de UMA fonte só. As ~196 chamadas
// `getUserOrg(userId)` da superfície de SESSÃO/PÁGINA (page-guards, layouts,
// páginas, org-scope) não passam opts → lêem o header AQUI dentro, ficando
// consistentes com os 2 call-sites que já passam hint explícito
// (context.ts/requireAuth e o layout do dashboard). Isso elimina o split-brain
// (gate numa org, página noutra) sem tocar em cada chamador.
//
// Os paths de MÁQUINA (bearer/Newton em require-auth.ts, delegação em context.ts)
// pinam `{ subdomainHint: null }` DE PROPÓSITO: a org do token vem do dono, não de
// um Host controlável pelo cliente — senão apontar a integração pra um subdomínio
// mudaria a org (ou daria 403). O overlay de impersonation cobre o super_admin
// "testando como" tenant; admin genuíno opera no apex (header ausente → home org).
// Ver memória project_multiorg_subdomain_resolution.
export async function getUserOrg(
  userId: string,
  opts?: { subdomainHint?: string | null }
) {
  // Overlay de impersonation: super_admin "testando como" o dono de um tenant
  // enxerga a org impersonada (ignora o subdomainHint). auth() não é sobreposto,
  // então `userId` aqui é sempre o admin real — a validação mora em getImpersonationFor.
  const imp = await getImpersonationFor(userId);
  if (imp) {
    return prisma.organization.findUnique({ where: { id: imp.orgId } });
  }

  // opts presente → hint explícito verbatim (não relê headers; o `null` do apex
  // já é intencional). opts ausente → lê o header do request scope atual.
  const subdomain =
    opts !== undefined
      ? opts.subdomainHint ?? null
      : await readRequestSubdomainHint();

  if (subdomain) {
    const scoped = await prisma.orgMembership.findFirst({
      where: { userId, org: { subdomain } },
      include: { org: true },
    });
    return scoped?.org ?? null;
  }
  const membership = await prisma.orgMembership.findFirst({
    where: { userId },
    include: { org: true },
    // Determinístico: a primeira org em que o user entrou (era ordem arbitrária
    // do Postgres). `invitedAt` é @default(now()) e NÃO é único (memberships
    // criadas na mesma transação/seed colidem), então desempata por `id` — sem
    // ele o Postgres tie-break voltaria a ser arbitrário. Não desambigua multi-org
    // no apex — lá não há sinal de tenant.
    orderBy: [{ invitedAt: "asc" }, { id: "asc" }],
  });
  return membership?.org ?? null;
}
