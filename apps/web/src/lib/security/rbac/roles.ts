import {
  PERMISSION,
  PermissionKey,
  PermissionMap,
  ALL_PERMISSIONS,
} from "./permissions";

export type RolePreset = "owner" | "admin" | "finance" | "sales" | "viewer" | "custom";

export const ROLE_LABELS_PT: Record<RolePreset, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  finance: "Financeiro",
  sales: "Vendas",
  viewer: "Visualizador",
  custom: "Personalizado",
};

export const ROLE_DESCRIPTIONS_PT: Record<RolePreset, string> = {
  owner: "Fundador da organização. Acesso total + transferência de propriedade.",
  admin: "Acesso total operacional + configurações (fees, KYC, dual approval).",
  finance: "Módulo Financeiro completo (cobranças, transfers pequenas, relatórios).",
  sales: "Captação + pipeline. Apenas cobranças dos próprios deals no financeiro.",
  viewer: "Leitura global com PII mascarada.",
  custom: "Permissões individualizadas definidas pelo admin.",
};

function fullAccess(): PermissionMap {
  return ALL_PERMISSIONS.reduce<PermissionMap>((acc, p) => {
    acc[p] = true;
    return acc;
  }, {});
}

function adminAccess(): PermissionMap {
  const perms = fullAccess();
  // Admin NÃO pode: deletar org, transferir ownership, rotacionar api key,
  // criar/ativar/arquivar contas bancárias (escopo exclusivo do owner) ou
  // gerenciar permissões por conta.
  perms[PERMISSION.ORG_DELETE] = false;
  perms[PERMISSION.ORG_TRANSFER_OWNERSHIP] = false;
  perms[PERMISSION.API_KEY_ROTATE] = false;
  perms[PERMISSION.ACCOUNT_CREATE] = false;
  perms[PERMISSION.ACCOUNT_ACTIVATE] = false;
  perms[PERMISSION.ACCOUNT_ARCHIVE] = false;
  perms[PERMISSION.ACCOUNT_PERMISSIONS_MANAGE] = false;
  return perms;
}

function financeAccess(): PermissionMap {
  return {
    [PERMISSION.ORG_SETTINGS_READ]: true,
    [PERMISSION.KYC_VIEW_STATUS]: true,
    [PERMISSION.CHARGE_CREATE_FROM_DEAL]: true,
    [PERMISSION.CHARGE_CREATE_AVULSA]: true,
    [PERMISSION.CHARGE_VIEW_ALL]: true,
    [PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY]: true,
    [PERMISSION.CHARGE_EDIT_DUE_DATE]: true,
    [PERMISSION.CHARGE_EDIT_DESCRIPTION]: true,
    [PERMISSION.CHARGE_CANCEL]: true,
    [PERMISSION.CHARGE_REFUND]: true, // com elevation extra
    [PERMISSION.CHARGE_RESEND_NOTIFICATION]: true,
    [PERMISSION.CHARGE_MARK_RECEIVED_IN_CASH]: true,
    [PERMISSION.CUSTOMER_CREATE]: true,
    [PERMISSION.CUSTOMER_EDIT]: true,
    [PERMISSION.CUSTOMER_VIEW_ALL]: true,
    [PERMISSION.CUSTOMER_VIEW_OWN_DEALS]: true,
    [PERMISSION.SPLIT_VIEW]: true,
    [PERMISSION.FEES_VIEW]: true,
    [PERMISSION.FINANCE_BALANCE_VIEW]: true,
    [PERMISSION.FINANCE_STATEMENT_VIEW]: true,
    [PERMISSION.FINANCE_STATEMENT_EXPORT]: true,
    [PERMISSION.TRANSFER_INIT]: true,
    [PERMISSION.TRANSFER_CONFIRM_BELOW_CAP]: true,
    [PERMISSION.TRANSFER_CANCEL_PENDING]: true,
    [PERMISSION.RECONCILIATION_VIEW]: true,
    [PERMISSION.RECONCILIATION_MATCH]: true,
    [PERMISSION.REPORT_VIEW]: true,
    [PERMISSION.REPORT_EXPORT]: true,
  };
}

function salesAccess(): PermissionMap {
  return {
    [PERMISSION.ORG_SETTINGS_READ]: true,
    [PERMISSION.KYC_VIEW_STATUS]: true,
    [PERMISSION.CHARGE_CREATE_FROM_DEAL]: true,
    [PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY]: true,
    [PERMISSION.CHARGE_EDIT_DESCRIPTION]: true,
    [PERMISSION.CHARGE_RESEND_NOTIFICATION]: true,
    [PERMISSION.CUSTOMER_VIEW_OWN_DEALS]: true,
    [PERMISSION.FEES_VIEW]: true,
  };
}

function viewerAccess(): PermissionMap {
  return {
    [PERMISSION.ORG_SETTINGS_READ]: true,
    [PERMISSION.KYC_VIEW_STATUS]: true,
    [PERMISSION.CHARGE_VIEW_ALL]: true, // PII mascarada
    [PERMISSION.CUSTOMER_VIEW_ALL]: true, // PII mascarada
    [PERMISSION.FEES_VIEW]: true,
    [PERMISSION.FINANCE_BALANCE_VIEW]: true,
    [PERMISSION.FINANCE_STATEMENT_VIEW]: true,
    [PERMISSION.RECONCILIATION_VIEW]: true,
    [PERMISSION.REPORT_VIEW]: true,
  };
}

export const ROLE_PRESETS: Record<Exclude<RolePreset, "custom">, PermissionMap> = {
  owner: fullAccess(),
  admin: adminAccess(),
  finance: financeAccess(),
  sales: salesAccess(),
  viewer: viewerAccess(),
};

export function resolvePermissions(
  role: RolePreset,
  customPermissions?: PermissionMap | null
): PermissionMap {
  if (role === "custom" && customPermissions) return customPermissions;
  if (role === "custom") return {};
  return ROLE_PRESETS[role];
}
