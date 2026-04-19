import { prisma } from "@/lib/db/prisma";
import { PermissionKey, PermissionMap, PERMISSION } from "./permissions";
import { resolvePermissions, RolePreset } from "./roles";

export interface EffectivePermissions {
  userId: string;
  orgId: string;
  role: RolePreset;
  customRoleName: string | null;
  permissions: PermissionMap;
}

/**
 * Resolve permissions efetivas de um user em uma org.
 * Retorna null se o user não é membro da org.
 */
export async function getEffectivePermissions(
  userId: string,
  orgId: string
): Promise<EffectivePermissions | null> {
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    include: { customRole: true },
  });
  if (!membership) return null;

  const role = (membership.role as RolePreset) ?? "viewer";
  const custom = membership.customRole
    ? (membership.customRole.permissions as PermissionMap)
    : null;

  return {
    userId,
    orgId,
    role,
    customRoleName: membership.customRole?.name ?? null,
    permissions: resolvePermissions(role, custom),
  };
}

export function can(
  effective: EffectivePermissions | null,
  permission: PermissionKey
): boolean {
  if (!effective) return false;
  return effective.permissions[permission] === true;
}

/**
 * Checa se o user pode acessar uma charge específica (respeitando scope do sales).
 * Implementação completa virá em Fase 1b quando CommissionCharge existir.
 */
export function canAccessCharge(params: {
  effective: EffectivePermissions;
  ownerUserId: string; // user que criou o deal
}): boolean {
  const { effective, ownerUserId } = params;

  // Admin/finance/viewer: todas as charges da org (a checagem de orgId é feita pelo caller)
  if (can(effective, PERMISSION.CHARGE_VIEW_ALL)) {
    return true;
  }

  // Sales: só próprios deals
  if (can(effective, PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY)) {
    return effective.userId === ownerUserId;
  }

  return false;
}
