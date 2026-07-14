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

/**
 * Checa se o user pode acessar UMA proposta específica.
 * VIEW_ALL (gestor/owner/admin/viewer) → qualquer uma da org.
 * VIEW_OWN_ONLY (corretor) → só as que ele criou.
 *
 * O `orgId` é responsabilidade do caller (o scopeWhere abaixo já injeta).
 */
export function canAccessProposal(params: {
  effective: EffectivePermissions;
  ownerUserId: string; // Proposal.userId (quem criou)
}): boolean {
  const { effective, ownerUserId } = params;
  if (can(effective, PERMISSION.PROPOSAL_VIEW_ALL)) return true;
  if (can(effective, PERMISSION.PROPOSAL_VIEW_OWN_ONLY)) {
    return effective.userId === ownerUserId;
  }
  return false;
}

/**
 * Cláusula `where` de escopo de proposta — DEVE ser espalhada no `where` de
 * TODA query de proposta (lista, detalhe, PATCH, preview, convert, duplicate,
 * export CSV, KPIs). Nunca filtrar pós-fetch: é o pós-fetch que gera o
 * esquecimento e vira IDOR.
 *
 * `null` = sem acesso a proposta nenhuma (nem VIEW_ALL nem VIEW_OWN_ONLY) — o
 * caller deve tratar como 403/lista vazia.
 *
 * Uso: `prisma.proposal.findMany({ where: { ...scope, status: "enviada" } })`.
 */
export function proposalScopeWhere(
  effective: EffectivePermissions | null
): { orgId: string } | { orgId: string; userId: string } | null {
  if (!effective) return null;
  if (can(effective, PERMISSION.PROPOSAL_VIEW_ALL)) {
    return { orgId: effective.orgId };
  }
  if (can(effective, PERMISSION.PROPOSAL_VIEW_OWN_ONLY)) {
    return { orgId: effective.orgId, userId: effective.userId };
  }
  return null;
}
