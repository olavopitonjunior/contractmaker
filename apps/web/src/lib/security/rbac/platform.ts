import { prisma } from "@/lib/db/prisma";

/**
 * Identidade de plataforma (super-admin) — separada do RBAC por-org.
 * Quem tem PlatformRole é staff da plataforma (Olavo + ops), não membro de
 * uma org. Espelha o padrão de lib/security/rbac/guard.ts::requirePermission.
 */

export type PlatformRoleName = "super_admin" | "support" | "billing";

export const PLATFORM_ROLES: readonly PlatformRoleName[] = [
  "super_admin",
  "support",
  "billing",
];

export class PlatformRoleRequiredError extends Error {
  status = 403;
  code = "PLATFORM_ROLE_REQUIRED";
  requiredRole: PlatformRoleName;

  constructor(role: PlatformRoleName) {
    super(`Platform role required: ${role}`);
    this.name = "PlatformRoleRequiredError";
    this.requiredRole = role;
  }
}

export interface PlatformContext {
  role: PlatformRoleName;
  scope: string[];
}

/** Retorna a PlatformRole do user, ou null se não for staff de plataforma. */
export async function getPlatformRole(
  userId: string
): Promise<PlatformContext | null> {
  const pr = await prisma.platformRole.findUnique({ where: { userId } });
  if (!pr) return null;
  return { role: pr.role as PlatformRoleName, scope: pr.scope };
}

/**
 * Lança PlatformRoleRequiredError se o user não satisfaz a role exigida.
 * `super_admin` satisfaz qualquer exigência; demais roles só a si mesmas.
 * Usar no topo de handlers em /api/admin/*.
 */
export async function requirePlatformRole(
  userId: string,
  role: PlatformRoleName
): Promise<PlatformContext> {
  const ctx = await getPlatformRole(userId);
  if (!ctx) throw new PlatformRoleRequiredError(role);
  if (ctx.role !== "super_admin" && ctx.role !== role) {
    throw new PlatformRoleRequiredError(role);
  }
  return ctx;
}
