/**
 * Chaves canônicas de permissões do módulo Pagadoria.
 *
 * Manter em sync com:
 * - roles.ts (presets)
 * - Plano: seção "Matriz de permissões"
 * - UI: RoleEditorDialog (agrupamento por categoria)
 */

export const PERMISSION = {
  // Organização e membros
  ORG_SETTINGS_READ: "org.settings.read",
  ORG_SETTINGS_EDIT: "org.settings.edit",
  ORG_MEMBERS_INVITE: "org.members.invite",
  ORG_MEMBERS_CHANGE_ROLE: "org.members.change_role",
  ORG_MEMBERS_REMOVE: "org.members.remove",
  ORG_DELETE: "org.delete",
  ORG_TRANSFER_OWNERSHIP: "org.transfer_ownership",

  // KYC e identidade
  KYC_SUBMIT: "kyc.submit",
  KYC_UPLOAD_DOCUMENT: "kyc.upload_document",
  KYC_VIEW_STATUS: "kyc.view_status",
  API_KEY_ROTATE: "api_key.rotate",
  API_KEY_VIEW_MASKED: "api_key.view_masked",
  ACCOUNT_CREATE: "account.create",
  ACCOUNT_ACTIVATE: "account.activate",
  ACCOUNT_ARCHIVE: "account.archive",
  ACCOUNT_PERMISSIONS_MANAGE: "account.permissions.manage",

  // Cobranças
  CHARGE_CREATE_FROM_DEAL: "charge.create.from_deal",
  CHARGE_CREATE_AVULSA: "charge.create.avulsa",
  CHARGE_VIEW_ALL: "charge.view.all",
  CHARGE_VIEW_OWN_DEALS_ONLY: "charge.view.own_deals_only",
  CHARGE_EDIT_DUE_DATE: "charge.edit_due_date",
  CHARGE_EDIT_DESCRIPTION: "charge.edit_description",
  CHARGE_CANCEL: "charge.cancel",
  CHARGE_REFUND: "charge.refund",
  CHARGE_RESEND_NOTIFICATION: "charge.resend_notification",
  CHARGE_MARK_RECEIVED_IN_CASH: "charge.mark_received_in_cash",

  // Clientes
  CUSTOMER_CREATE: "customer.create",
  CUSTOMER_EDIT: "customer.edit",
  CUSTOMER_DELETE: "customer.delete",
  CUSTOMER_VIEW_ALL: "customer.view.all",
  CUSTOMER_VIEW_OWN_DEALS: "customer.view.own_deals",

  // Split e taxas
  SPLIT_VIEW: "split.view",
  SPLIT_CONFIGURE: "split.configure",
  FEES_VIEW: "fees.view",
  FEES_CONFIGURE: "fees.configure",
  FEES_BRANDING_CONFIGURE: "fees.branding.configure",

  // Transferências e saldo
  FINANCE_BALANCE_VIEW: "finance.balance.view",
  FINANCE_STATEMENT_VIEW: "finance.statement.view",
  FINANCE_STATEMENT_EXPORT: "finance.statement.export",
  TRANSFER_INIT: "transfer.init",
  TRANSFER_CONFIRM_BELOW_CAP: "transfer.confirm_below_cap",
  TRANSFER_CONFIRM_ABOVE_CAP: "transfer.confirm_above_cap",
  TRANSFER_DUAL_APPROVE: "transfer.dual_approve",
  TRANSFER_CANCEL_PENDING: "transfer.cancel_pending",

  // Conciliação, relatórios, auditoria
  RECONCILIATION_VIEW: "reconciliation.view",
  RECONCILIATION_MATCH: "reconciliation.match",
  REPORT_VIEW: "report.view",
  REPORT_EXPORT: "report.export",
  AUDIT_VIEW: "audit.view",
  AUDIT_EXPORT: "audit.export",
} as const;

export type PermissionKey =
  (typeof PERMISSION)[keyof typeof PERMISSION];

export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSION);

export const PERMISSION_CATEGORIES: Record<string, PermissionKey[]> = {
  "Organização e membros": [
    PERMISSION.ORG_SETTINGS_READ,
    PERMISSION.ORG_SETTINGS_EDIT,
    PERMISSION.ORG_MEMBERS_INVITE,
    PERMISSION.ORG_MEMBERS_CHANGE_ROLE,
    PERMISSION.ORG_MEMBERS_REMOVE,
    PERMISSION.ORG_TRANSFER_OWNERSHIP,
    PERMISSION.ORG_DELETE,
  ],
  "KYC e identidade": [
    PERMISSION.KYC_SUBMIT,
    PERMISSION.KYC_UPLOAD_DOCUMENT,
    PERMISSION.KYC_VIEW_STATUS,
    PERMISSION.API_KEY_ROTATE,
    PERMISSION.API_KEY_VIEW_MASKED,
    PERMISSION.ACCOUNT_CREATE,
    PERMISSION.ACCOUNT_ACTIVATE,
    PERMISSION.ACCOUNT_ARCHIVE,
    PERMISSION.ACCOUNT_PERMISSIONS_MANAGE,
  ],
  "Cobranças": [
    PERMISSION.CHARGE_CREATE_FROM_DEAL,
    PERMISSION.CHARGE_CREATE_AVULSA,
    PERMISSION.CHARGE_VIEW_ALL,
    PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY,
    PERMISSION.CHARGE_EDIT_DUE_DATE,
    PERMISSION.CHARGE_EDIT_DESCRIPTION,
    PERMISSION.CHARGE_CANCEL,
    PERMISSION.CHARGE_REFUND,
    PERMISSION.CHARGE_RESEND_NOTIFICATION,
    PERMISSION.CHARGE_MARK_RECEIVED_IN_CASH,
  ],
  "Clientes": [
    PERMISSION.CUSTOMER_CREATE,
    PERMISSION.CUSTOMER_EDIT,
    PERMISSION.CUSTOMER_DELETE,
    PERMISSION.CUSTOMER_VIEW_ALL,
    PERMISSION.CUSTOMER_VIEW_OWN_DEALS,
  ],
  "Split e taxas": [
    PERMISSION.SPLIT_VIEW,
    PERMISSION.SPLIT_CONFIGURE,
    PERMISSION.FEES_VIEW,
    PERMISSION.FEES_CONFIGURE,
    PERMISSION.FEES_BRANDING_CONFIGURE,
  ],
  "Transferências e saldo": [
    PERMISSION.FINANCE_BALANCE_VIEW,
    PERMISSION.FINANCE_STATEMENT_VIEW,
    PERMISSION.FINANCE_STATEMENT_EXPORT,
    PERMISSION.TRANSFER_INIT,
    PERMISSION.TRANSFER_CONFIRM_BELOW_CAP,
    PERMISSION.TRANSFER_CONFIRM_ABOVE_CAP,
    PERMISSION.TRANSFER_DUAL_APPROVE,
    PERMISSION.TRANSFER_CANCEL_PENDING,
  ],
  "Conciliação, relatórios e auditoria": [
    PERMISSION.RECONCILIATION_VIEW,
    PERMISSION.RECONCILIATION_MATCH,
    PERMISSION.REPORT_VIEW,
    PERMISSION.REPORT_EXPORT,
    PERMISSION.AUDIT_VIEW,
    PERMISSION.AUDIT_EXPORT,
  ],
};

export const PERMISSION_LABELS_PT: Record<PermissionKey, string> = {
  [PERMISSION.ORG_SETTINGS_READ]: "Ver configurações da organização",
  [PERMISSION.ORG_SETTINGS_EDIT]: "Editar configurações da organização",
  [PERMISSION.ORG_MEMBERS_INVITE]: "Convidar membros",
  [PERMISSION.ORG_MEMBERS_CHANGE_ROLE]: "Alterar função de membros",
  [PERMISSION.ORG_MEMBERS_REMOVE]: "Remover membros",
  [PERMISSION.ORG_DELETE]: "Deletar organização",
  [PERMISSION.ORG_TRANSFER_OWNERSHIP]: "Transferir propriedade",
  [PERMISSION.KYC_SUBMIT]: "Submeter dados KYC",
  [PERMISSION.KYC_UPLOAD_DOCUMENT]: "Enviar documentos KYC",
  [PERMISSION.KYC_VIEW_STATUS]: "Ver status do KYC",
  [PERMISSION.API_KEY_ROTATE]: "Rotacionar API key da conta Asaas",
  [PERMISSION.API_KEY_VIEW_MASKED]: "Ver API key (mascarada)",
  [PERMISSION.ACCOUNT_CREATE]: "Criar nova conta bancária Asaas",
  [PERMISSION.ACCOUNT_ACTIVATE]: "Selecionar conta bancária ativa da org",
  [PERMISSION.ACCOUNT_ARCHIVE]: "Arquivar conta bancária",
  [PERMISSION.ACCOUNT_PERMISSIONS_MANAGE]: "Gerenciar permissões por conta",
  [PERMISSION.CHARGE_CREATE_FROM_DEAL]: "Criar cobrança a partir de Deal",
  [PERMISSION.CHARGE_CREATE_AVULSA]: "Criar cobrança avulsa",
  [PERMISSION.CHARGE_VIEW_ALL]: "Ver todas as cobranças",
  [PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY]: "Ver apenas cobranças dos próprios deals",
  [PERMISSION.CHARGE_EDIT_DUE_DATE]: "Alterar vencimento",
  [PERMISSION.CHARGE_EDIT_DESCRIPTION]: "Editar descrição",
  [PERMISSION.CHARGE_CANCEL]: "Cancelar cobrança",
  [PERMISSION.CHARGE_REFUND]: "Estornar cobrança",
  [PERMISSION.CHARGE_RESEND_NOTIFICATION]: "Reenviar notificação ao pagador",
  [PERMISSION.CHARGE_MARK_RECEIVED_IN_CASH]: "Marcar como recebido em dinheiro",
  [PERMISSION.CUSTOMER_CREATE]: "Criar cliente",
  [PERMISSION.CUSTOMER_EDIT]: "Editar cliente",
  [PERMISSION.CUSTOMER_DELETE]: "Deletar cliente",
  [PERMISSION.CUSTOMER_VIEW_ALL]: "Ver todos os clientes",
  [PERMISSION.CUSTOMER_VIEW_OWN_DEALS]: "Ver clientes dos próprios deals",
  [PERMISSION.SPLIT_VIEW]: "Ver configuração de split",
  [PERMISSION.SPLIT_CONFIGURE]: "Configurar split",
  [PERMISSION.FEES_VIEW]: "Ver taxas e descontos",
  [PERMISSION.FEES_CONFIGURE]: "Configurar taxas e descontos",
  [PERMISSION.FEES_BRANDING_CONFIGURE]: "Configurar branding da cobrança",
  [PERMISSION.FINANCE_BALANCE_VIEW]: "Ver saldo",
  [PERMISSION.FINANCE_STATEMENT_VIEW]: "Ver extrato",
  [PERMISSION.FINANCE_STATEMENT_EXPORT]: "Exportar extrato",
  [PERMISSION.TRANSFER_INIT]: "Iniciar transferência",
  [PERMISSION.TRANSFER_CONFIRM_BELOW_CAP]: "Confirmar transferência abaixo do cap",
  [PERMISSION.TRANSFER_CONFIRM_ABOVE_CAP]: "Confirmar transferência acima do cap",
  [PERMISSION.TRANSFER_DUAL_APPROVE]: "Aprovar dual approval",
  [PERMISSION.TRANSFER_CANCEL_PENDING]: "Cancelar transferência pendente",
  [PERMISSION.RECONCILIATION_VIEW]: "Ver conciliação",
  [PERMISSION.RECONCILIATION_MATCH]: "Fazer match de conciliação",
  [PERMISSION.REPORT_VIEW]: "Ver relatórios",
  [PERMISSION.REPORT_EXPORT]: "Exportar relatórios",
  [PERMISSION.AUDIT_VIEW]: "Ver log de auditoria",
  [PERMISSION.AUDIT_EXPORT]: "Exportar log de auditoria",
};
