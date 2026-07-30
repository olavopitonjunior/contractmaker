import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";

/**
 * Quem pode VER o guia de onboarding (checklist na sidebar + redirect de 1º
 * acesso) e concluí-lo: **owner OU admin**.
 *
 * Antes era só `owner`, e admin — que também configura o tenant (perfil da
 * imobiliária, templates, Google, formulário, convites) — não via o guia nem
 * caía no /onboarding, ficando sem trilha nenhuma. `POST /api/onboarding/complete`
 * já aceitava owner|admin, então o gate de leitura estava mais restrito que o de
 * escrita.
 *
 * Impersonation-aware: resolve o usuário EFETIVO (super_admin "testando como" o
 * dono da org enxerga o guia que o dono enxergaria).
 */
const ONBOARDING_ROLES = ["owner", "admin"] as const;

/** owner/admin da org (impersonation-aware) + o id efetivo já resolvido. */
export async function resolveOnboardingActor(
  userId: string,
  orgId: string
): Promise<{ effUserId: string; isOwnerAdmin: boolean }> {
  const effUserId = await getEffectiveUserId(userId);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  const isOwnerAdmin =
    !!membership && (ONBOARDING_ROLES as readonly string[]).includes(membership.role);
  return { effUserId, isOwnerAdmin };
}

/** true quando o usuário pode ver o onboarding (owner|admin) nessa org. */
export async function canSeeOnboarding(userId: string, orgId: string): Promise<boolean> {
  const { isOwnerAdmin } = await resolveOnboardingActor(userId, orgId);
  return isOwnerAdmin;
}
