import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  PermissionKey,
  PermissionMap,
  PERMISSION,
  MANAGER_CONFIGURABLE_PERMISSIONS,
} from "./permissions";
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

  // Gerente: o preset é mesclado com os overrides da ORG (um conjunto pra
  // todos os gerentes — OrgManagerSettings.permissionsJson). Filtrado pela
  // whitelist na leitura também (defesa em profundidade; o PATCH já valida).
  let orgOverrides: PermissionMap | null = null;
  if (role === "gerente") {
    const settings = await prisma.orgManagerSettings.findUnique({
      where: { orgId },
      select: { permissionsJson: true },
    });
    const raw = (settings?.permissionsJson ?? {}) as Record<string, unknown>;
    const filtered: PermissionMap = {};
    for (const key of MANAGER_CONFIGURABLE_PERMISSIONS) {
      if (typeof raw[key] === "boolean") filtered[key] = raw[key] as boolean;
    }
    orgOverrides = filtered;
  }

  return {
    userId,
    orgId,
    role,
    customRoleName: membership.customRole?.name ?? null,
    permissions: resolvePermissions(role, custom, orgOverrides),
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
 * VIEW_OWN_ONLY (corretor) → as que ele criou OU as em que é o responsável
 * atribuído (`responsibleUserId`). Combina com a atribuição de responsável:
 * quem cria E quem recebe enxergam a proposta.
 *
 * O `orgId` é responsabilidade do caller (o scopeWhere abaixo já injeta).
 */
export function canAccessProposal(params: {
  effective: EffectivePermissions;
  ownerUserId: string; // Proposal.userId (quem criou)
  responsibleUserId?: string | null; // Proposal.responsibleUserId (corretor atribuído)
}): boolean {
  const { effective, ownerUserId, responsibleUserId } = params;
  if (can(effective, PERMISSION.PROPOSAL_VIEW_ALL)) return true;
  if (can(effective, PERMISSION.PROPOSAL_VIEW_OWN_ONLY)) {
    return (
      effective.userId === ownerUserId ||
      (!!responsibleUserId && effective.userId === responsibleUserId)
    );
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
/**
 * Checa se o user pode acessar UM deal específico.
 * DEAL_VIEW_ALL → qualquer deal da org (org check é do caller).
 * DEAL_VIEW_ASSIGNED_ONLY (gerente) → deals onde ele é o gerente atribuído
 * (`managerUserId`) OU o criador (`userId` — deal criado pelo próprio gerente
 * não pode sumir dele).
 * Nenhuma das duas chaves → true (fail-open deliberado: CustomRoles gravadas
 * antes da feature Gerente não têm as chaves novas e hoje veem o kanban
 * inteiro; só DEAL_VIEW_ASSIGNED_ONLY estreita — a chave restritiva é opt-in).
 */
export function canAccessDeal(params: {
  effective: EffectivePermissions;
  ownerUserId: string; // Deal.userId (quem criou)
  managerUserId?: string | null; // Deal.managerUserId (gerente atribuído)
}): boolean {
  const { effective, ownerUserId, managerUserId } = params;
  if (can(effective, PERMISSION.DEAL_VIEW_ALL)) return true;
  if (can(effective, PERMISSION.DEAL_VIEW_ASSIGNED_ONLY)) {
    return (
      effective.userId === ownerUserId ||
      (!!managerUserId && effective.userId === managerUserId)
    );
  }
  return true; // fail-open (status quo pré-feature) — ver docstring
}

/**
 * Cláusula `where` de escopo de deal — espalhar no `where` de TODA listagem
 * de deal (kanban vendas/locação, listas, KPIs). Espelha proposalScopeWhere,
 * mas com fail-open: sem nenhuma das chaves de view, mantém a visão org-wide
 * (status quo pré-feature; roles/CustomRoles antigas não regridem).
 *
 * `null` = caller sem permissões resolvidas (sem membership) — tratar como
 * 403/lista vazia. O escopo de org (pipeline.orgId) é responsabilidade do
 * caller, que já resolve o pipeline via getPipelineByKind(orgId, ...).
 */
export function dealScopeWhere(
  effective: EffectivePermissions | null
): Prisma.DealWhereInput | null {
  if (!effective) return null;
  const restricted =
    can(effective, PERMISSION.DEAL_VIEW_ASSIGNED_ONLY) &&
    !can(effective, PERMISSION.DEAL_VIEW_ALL);
  if (restricted) {
    return {
      OR: [
        { managerUserId: effective.userId },
        { userId: effective.userId },
      ],
    };
  }
  return {};
}

export function proposalScopeWhere(
  effective: EffectivePermissions | null
):
  | { orgId: string }
  | { orgId: string; OR: [{ userId: string }, { responsibleUserId: string }] }
  | null {
  if (!effective) return null;
  if (can(effective, PERMISSION.PROPOSAL_VIEW_ALL)) {
    return { orgId: effective.orgId };
  }
  if (can(effective, PERMISSION.PROPOSAL_VIEW_OWN_ONLY)) {
    // Criador OU responsável atribuído. Nome de não-usuário (responsibleName)
    // é só rótulo — não entra no scope.
    return {
      orgId: effective.orgId,
      OR: [{ userId: effective.userId }, { responsibleUserId: effective.userId }],
    };
  }
  return null;
}
