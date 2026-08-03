import {
  PERMISSION,
  PermissionKey,
  PermissionMap,
  ALL_PERMISSIONS,
} from "./permissions";

export type RolePreset =
  | "owner"
  | "admin"
  | "finance"
  | "sales"
  | "viewer"
  | "custom"
  | "gerente"             // vê/opera só os deals onde é o gerente atribuído
  // Locação (presets):
  | "gestor_locacao"      // operador do módulo de locação
  | "gestor_financeiro"   // foca em /financeiro + repasses
  | "vistoriador"         // só PWA de vistoria
  | "proprietario"        // portal do proprietário
  | "inquilino";          // portal do inquilino

export const ROLE_LABELS_PT: Record<RolePreset, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  finance: "Financeiro",
  sales: "Vendas",
  viewer: "Visualizador",
  custom: "Personalizado",
  gerente: "Gerente",
  gestor_locacao: "Gestor de Locação",
  gestor_financeiro: "Gestor Financeiro",
  vistoriador: "Vistoriador",
  proprietario: "Proprietário (portal)",
  inquilino: "Inquilino (portal)",
};

export const ROLE_DESCRIPTIONS_PT: Record<RolePreset, string> = {
  owner: "Fundador da organização. Acesso total + transferência de propriedade.",
  admin: "Acesso total operacional + configurações (fees, KYC, dual approval).",
  finance: "Módulo Financeiro completo (cobranças, transfers pequenas, relatórios).",
  sales: "Captação + pipeline. Apenas cobranças dos próprios deals no financeiro.",
  viewer: "Leitura global com PII mascarada.",
  custom: "Permissões individualizadas definidas pelo admin.",
  gerente:
    "Enxerga e opera apenas os negócios em que foi atribuído como gerente. Ações liberadas pelo admin em Configurações → Gerentes.",
  gestor_locacao: "Operador de locação — imóveis, contratos, vistorias, checklists, cobranças e despesas. Sem ações financeiras de saída.",
  gestor_financeiro: "Foco em cobranças, repasses, conciliação e relatórios de locação. Sem CRUD de imóveis.",
  vistoriador: "Apenas vistorias agendadas atribuídas a ele (PWA `/vistoria/[os]`).",
  proprietario: "Portal do proprietário — leitura de extrato, repasses, informe IR.",
  inquilino: "Portal do inquilino — contrato, boletos PIX, recibos, chamados.",
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
    // Pipeline (retrocompat 2026-07): finance sempre viu o kanban inteiro.
    [PERMISSION.DEAL_VIEW_ALL]: true,
    [PERMISSION.ENVELOPE_VIEW]: true,
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
    // Pipeline (retrocompat 2026-07): sales sempre operou o kanban inteiro —
    // grants explícitos preservam o status quo com as chaves novas.
    [PERMISSION.DEAL_VIEW_ALL]: true,
    [PERMISSION.DEAL_EDIT]: true,
    [PERMISSION.DEAL_MANAGER_ASSIGN]: true,
    [PERMISSION.CONTRACT_CREATE]: true,
    [PERMISSION.CONTRACT_EDIT]: true,
    [PERMISSION.ENVELOPE_VIEW]: true,
    [PERMISSION.ENVELOPE_SEND]: true,
    // Corretor: opera as PRÓPRIAS propostas ponta a ponta (cria, envia,
    // converte, cancela, reenvia, atribui), mas só enxerga as dele/atribuídas.
    // Sem PROPOSAL_VIEW_ALL nem PROPOSAL_DELETE de propósito (delete é destrutivo).
    [PERMISSION.PROPOSAL_VIEW_OWN_ONLY]: true,
    [PERMISSION.PROPOSAL_CREATE]: true,
    [PERMISSION.PROPOSAL_SEND]: true,
    [PERMISSION.PROPOSAL_CONVERT]: true,
    [PERMISSION.PROPOSAL_CANCEL]: true,
    [PERMISSION.PROPOSAL_RESEND]: true,
    [PERMISSION.PROPOSAL_ASSIGN]: true,
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
    // Leitura global — vê todas as propostas (gestor/auditoria), sem criar.
    [PERMISSION.PROPOSAL_VIEW_ALL]: true,
    // Pipeline (retrocompat 2026-07): leitura global do kanban.
    [PERMISSION.DEAL_VIEW_ALL]: true,
    [PERMISSION.ENVELOPE_VIEW]: true,
  };
}

function gerenteAccess(): PermissionMap {
  // Base CONSERVADORA do gerente: enxerga e acompanha os deals atribuídos a
  // ele (vendas e locação), mas as ações (gerar/editar contrato, enviar
  // assinatura, emitir proposta, cobrar) nascem DESLIGADAS — o admin liga o
  // que quiser em /settings/gerentes (OrgManagerSettings.permissionsJson,
  // só chaves de MANAGER_CONFIGURABLE_PERMISSIONS), valendo pra todos os
  // gerentes da org.
  return {
    [PERMISSION.ORG_SETTINGS_READ]: true,
    [PERMISSION.KYC_VIEW_STATUS]: true,
    [PERMISSION.DEAL_VIEW_ASSIGNED_ONLY]: true,
    [PERMISSION.DEAL_EDIT]: true,
    [PERMISSION.ENVELOPE_VIEW]: true,
    [PERMISSION.PROPOSAL_VIEW_OWN_ONLY]: true,
    // Leituras de locação — sem elas o gerente vê o card no kanban de locação
    // mas as abas do deal (seguros, vistorias, garantias, análise de crédito)
    // negam. Tudo read-only; mutações continuam gated (LEASE_CREATE etc.).
    [PERMISSION.LEASE_VIEW]: true,
    [PERMISSION.PROPERTY_VIEW]: true,
    [PERMISSION.GUARANTEE_VIEW]: true,
    [PERMISSION.RENT_VIEW]: true,
    [PERMISSION.INSURANCE_VIEW]: true,
    [PERMISSION.INSPECTION_VIEW]: true,
    [PERMISSION.CREDIT_ANALYSIS_VIEW]: true,
    [PERMISSION.CHECKLIST_VIEW]: true,
  };
}

function gestorLocacaoAccess(): PermissionMap {
  // Operação completa do módulo Locação. Sem ações financeiras de saída
  // (transferência, dual approval) — isto é do gestor_financeiro/admin.
  return {
    [PERMISSION.ORG_SETTINGS_READ]: true,
    [PERMISSION.KYC_VIEW_STATUS]: true,
    [PERMISSION.CUSTOMER_VIEW_ALL]: true,
    [PERMISSION.PROPERTY_VIEW]: true,
    [PERMISSION.PROPERTY_CREATE]: true,
    [PERMISSION.PROPERTY_EDIT]: true,
    [PERMISSION.PROPERTY_OWNERSHIP_MANAGE]: true,
    [PERMISSION.LEASE_VIEW]: true,
    [PERMISSION.LEASE_CREATE]: true,
    [PERMISSION.LEASE_EDIT]: true,
    [PERMISSION.LEASE_RENEW]: true,
    [PERMISSION.LEASE_TERMINATE]: true,
    [PERMISSION.GUARANTEE_VIEW]: true,
    [PERMISSION.GUARANTEE_MANAGE]: true,
    [PERMISSION.RENT_VIEW]: true,
    [PERMISSION.RENT_GENERATE]: true,
    [PERMISSION.RENT_REMIND]: true,
    [PERMISSION.EXPENSE_VIEW]: true,
    [PERMISSION.EXPENSE_CREATE]: true,
    [PERMISSION.EXPENSE_EDIT]: true,
    [PERMISSION.CHECKLIST_VIEW]: true,
    [PERMISSION.CHECKLIST_MANAGE]: true,
    [PERMISSION.CHECKLIST_TEMPLATE_MANAGE]: true,
    [PERMISSION.DEBT_AGREEMENT_VIEW]: true,
    [PERMISSION.DEBT_AGREEMENT_CREATE]: true,
    [PERMISSION.INSURANCE_VIEW]: true,
    [PERMISSION.INSURANCE_MANAGE]: true,
    [PERMISSION.INSPECTION_VIEW]: true,
    [PERMISSION.INSPECTION_CREATE]: true,
    [PERMISSION.MAINTENANCE_VIEW]: true,
    [PERMISSION.MAINTENANCE_MANAGE]: true,
    [PERMISSION.CREDIT_ANALYSIS_VIEW]: true,
    [PERMISSION.CREDIT_ANALYSIS_DECIDE]: true,
    [PERMISSION.CLIENT_VIEW]: true,
    [PERMISSION.CLIENT_CREATE]: true,
    [PERMISSION.CLIENT_UPDATE]: true,
    [PERMISSION.NEWTON_REQUEST_CREATE]: true,
    [PERMISSION.NEWTON_REQUEST_VIEW]: true,
    [PERMISSION.NEWTON_INTENT_APPROVE]: true,
    [PERMISSION.REPORT_VIEW]: true,
    // Pipeline (retrocompat 2026-07): gestor de locação opera a esteira inteira.
    [PERMISSION.DEAL_VIEW_ALL]: true,
    [PERMISSION.DEAL_EDIT]: true,
    [PERMISSION.DEAL_MANAGER_ASSIGN]: true,
    [PERMISSION.CONTRACT_CREATE]: true,
    [PERMISSION.CONTRACT_EDIT]: true,
    [PERMISSION.ENVELOPE_VIEW]: true,
    [PERMISSION.ENVELOPE_SEND]: true,
    // Gestor de locação: enxerga todas as propostas da carteira e opera todas.
    [PERMISSION.PROPOSAL_VIEW_ALL]: true,
    [PERMISSION.PROPOSAL_CREATE]: true,
    [PERMISSION.PROPOSAL_SEND]: true,
    [PERMISSION.PROPOSAL_CONVERT]: true,
    [PERMISSION.PROPOSAL_CANCEL]: true,
    [PERMISSION.PROPOSAL_DELETE]: true,
    [PERMISSION.PROPOSAL_RESEND]: true,
    [PERMISSION.PROPOSAL_ASSIGN]: true,
  };
}

function gestorFinanceiroAccess(): PermissionMap {
  // Foca em cobranças/repasses/conciliação/relatórios do módulo Locação +
  // os equivalentes de venda. Não cria/edita imóveis.
  const base = financeAccess();
  return {
    ...base,
    [PERMISSION.RENT_VIEW]: true,
    [PERMISSION.RENT_GENERATE]: true,
    [PERMISSION.RENT_REMIND]: true,
    [PERMISSION.RENT_MARK_REPASSED]: true,
    [PERMISSION.EXPENSE_VIEW]: true,
    [PERMISSION.EXPENSE_CREATE]: true,
    [PERMISSION.EXPENSE_EDIT]: true,
    [PERMISSION.DEBT_AGREEMENT_VIEW]: true,
    [PERMISSION.DEBT_AGREEMENT_CREATE]: true,
    [PERMISSION.LEASE_VIEW]: true,
    [PERMISSION.GUARANTEE_VIEW]: true,
    [PERMISSION.PROPERTY_VIEW]: true,
    [PERMISSION.NEWTON_INTENT_APPROVE]: true,
  };
}

function vistoriadorAccess(): PermissionMap {
  // Acesso restrito ao PWA de vistoria. Pode ver os imóveis cuja vistoria
  // foi atribuída a ele e marcar status. Sem visibilidade financeira.
  return {
    [PERMISSION.PROPERTY_VIEW]: true,
    [PERMISSION.LEASE_VIEW]: true,
    [PERMISSION.INSPECTION_VIEW]: true,
    [PERMISSION.INSPECTION_EXECUTE]: true,
    [PERMISSION.CHECKLIST_VIEW]: true,
  };
}

function proprietarioPortalAccess(): PermissionMap {
  // Portal do proprietário: leitura de extrato + repasses + informe IR.
  return {
    [PERMISSION.OWNER_PORTAL_ACCESS]: true,
    [PERMISSION.LEASE_VIEW]: true,
    [PERMISSION.GUARANTEE_VIEW]: true,
    [PERMISSION.RENT_VIEW]: true,
    [PERMISSION.PROPERTY_VIEW]: true,
  };
}

function inquilinoPortalAccess(): PermissionMap {
  return {
    [PERMISSION.TENANT_PORTAL_ACCESS]: true,
    [PERMISSION.LEASE_VIEW]: true,
    [PERMISSION.GUARANTEE_VIEW]: true,
    [PERMISSION.RENT_VIEW]: true,
  };
}

export const ROLE_PRESETS: Record<Exclude<RolePreset, "custom">, PermissionMap> = {
  owner: fullAccess(),
  admin: adminAccess(),
  finance: financeAccess(),
  sales: salesAccess(),
  viewer: viewerAccess(),
  gerente: gerenteAccess(),
  gestor_locacao: gestorLocacaoAccess(),
  gestor_financeiro: gestorFinanceiroAccess(),
  vistoriador: vistoriadorAccess(),
  proprietario: proprietarioPortalAccess(),
  inquilino: inquilinoPortalAccess(),
};

/**
 * `orgOverrides`: overrides booleanos da ORG sobre o preset (hoje só o role
 * `gerente`, vindos de OrgManagerSettings.permissionsJson). O fetch é do
 * caller (getEffectivePermissions) — esta função permanece pura.
 */
export function resolvePermissions(
  role: RolePreset,
  customPermissions?: PermissionMap | null,
  orgOverrides?: PermissionMap | null
): PermissionMap {
  if (role === "custom") return customPermissions ?? {};
  // `role` vem do banco (membership.role é String) — pode carregar valores fora
  // do catálogo, como o "member" que o signup público legado gravava. Sem este
  // guard, `permissions` ficava undefined e can() derrubava QUALQUER página com
  // RBAC num TypeError. Menor privilégio: nega tudo (fail-opens documentados,
  // como o de dealScopeWhere, continuam valendo por decisão própria de lá).
  const base: PermissionMap | undefined = ROLE_PRESETS[role];
  if (!base) {
    console.warn(
      `[rbac] role desconhecido "${role}" — resolvendo como sem permissões`
    );
    return {};
  }
  if (orgOverrides && Object.keys(orgOverrides).length > 0) {
    return { ...base, ...orgOverrides };
  }
  return base;
}
