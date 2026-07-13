import { prisma } from "@/lib/db/prisma";

export type AuditResult = "SUCCESS" | "FAILURE" | "DENIED";

export type AuditAction =
  // Auth / identidade
  | "LOGIN_ELEVATED"
  | "LOGIN_ELEVATION_FAILED"
  | "USER_LOGOUT"
  | "PASSWORD_RESET"
  | "PASSWORD_INITIAL_SET"
  | "PASSWORD_CHANGE"
  | "USER_PROFILE_UPDATE"
  | "2FA_ENABLE"
  | "2FA_DISABLE"
  | "2FA_RECOVERY_USED"
  | "2FA_RECOVERY_REGENERATED"
  | "TRUSTED_DEVICE_ADDED"
  | "TRUSTED_DEVICE_REVOKED"
  | "CHALLENGE_CREATED"
  | "CHALLENGE_CONFIRMED"
  | "CHALLENGE_FAILED"
  | "CHALLENGE_EXPIRED"
  // RBAC
  | "MEMBER_INVITED"
  | "MEMBER_INVITE_RESENT"
  | "INVITATION_CREATED"
  | "INVITATION_APPROVED"
  | "INVITATION_REJECTED"
  | "MEMBER_REMOVED"
  | "MEMBER_LEFT"
  | "MEMBER_ROLE_CHANGED"
  | "MEMBER_ROLE_CHANGED_TARGET"
  | "OWNERSHIP_TRANSFERRED"
  | "CUSTOM_ROLE_CREATED"
  | "CUSTOM_ROLE_UPDATED"
  | "CUSTOM_ROLE_DELETED"
  // KYC / Asaas
  | "KYC_SUBMIT"
  | "KYC_DOC_UPLOAD"
  | "KYC_STATUS_UPDATED"
  | "KYC_RESUBMIT"
  | "API_KEY_ROTATE"
  // Multi-account Asaas
  | "ACCOUNT_CREATE"
  | "ACCOUNT_ACTIVATE"
  | "ACCOUNT_ARCHIVE"
  | "ACCOUNT_PERMISSION_GRANT"
  | "ACCOUNT_PERMISSION_REVOKE"
  | "ACCOUNT_LABEL_UPDATE"
  | "ACCOUNT_ACTIVATION_LINK_RESENT"
  // Cobrança
  | "CHARGE_CREATE"
  | "CHARGE_CANCEL"
  | "CHARGE_REFUND"
  | "CHARGE_EDIT"
  | "CHARGE_NOTIFICATION_RESEND"
  | "CHARGE_MARK_RECEIVED_IN_CASH"
  | "SANDBOX_PAYMENT_CONFIRMED"
  // Transferências
  | "TRANSFER_INIT"
  | "TRANSFER_CONFIRM"
  | "TRANSFER_CANCEL"
  | "TRANSFER_DENIED"
  | "TRANSFER_RETRY_SUCCESS"
  | "TRANSFER_RETRY_FAILED"
  // Dual approval
  | "DUAL_APPROVAL_CREATED"
  | "DUAL_APPROVAL_APPROVED"
  | "DUAL_APPROVAL_REJECTED"
  | "DUAL_APPROVAL_EXPIRED"
  | "DUAL_APPROVAL_TAMPERED"
  // Taxas / config
  | "FEES_UPDATED"
  | "BRANDING_UPDATED"
  // Plataforma / multitenant (super-admin)
  | "ORG_CREATED"
  | "ORG_UPDATED"
  | "ORG_MODULES_UPDATED"
  | "ORG_SUSPENDED"
  | "ORG_REACTIVATED"
  | "ORG_DELETED"
  | "ORG_BRANDING_UPDATED"
  | "ORG_FEES_UPDATED"
  | "PLATFORM_ROLE_GRANTED"
  | "PLATFORM_ROLE_REVOKED"
  | "IMPERSONATION_STARTED"
  | "IMPERSONATION_ENDED"
  // Split de pagamento (recipients)
  | "SPLIT_RECIPIENT_CREATED"
  | "SPLIT_RECIPIENT_UPDATED"
  | "SPLIT_RECIPIENT_DELETED"
  | "SPLIT_RECIPIENT_BULK_IMPORT"
  | "SPLIT_RECIPIENT_COMPLETION_REQUESTED"
  | "SPLIT_RECIPIENT_COMPLETED"
  // LGPD / DSAR
  | "DATA_EXPORT_REQUESTED"
  | "DATA_DELETE_REQUESTED"
  | "DATA_DELETED"
  | "DATA_DELETION_CANCELLED"
  // Segurança geral
  | "SUSPICIOUS_ACTIVITY"
  | "RATE_LIMIT_HIT"
  // Newton — integração com agente externo
  | "API_TOKEN_CREATED"
  | "API_TOKEN_REVOKED"
  | "API_TOKEN_AUTH_FAILED"
  | "NEWTON_ACTOR_HEADER_REJECTED"
  | "DELEGATION_ASSUMED"
  | "DELEGATION_REJECTED"
  | "CONTRACT_FIELD_UPDATE"
  | "ENVELOPE_CANCEL"
  // Operações de domínio expostas a Newton via Bearer
  | "DEAL_CREATE"
  | "DEAL_UPDATE"
  | "DEAL_DELETE"
  | "DEAL_STAGE_CHANGE"
  | "DEAL_ARCHIVED"
  | "DEAL_UNARCHIVED"
  | "FORM_CREATE"
  | "FORM_UPDATE"
  | "FORM_PATCH_REJECTED_PATH"
  | "FORM_SETTINGS_UPDATE"
  | "FORM_PREFILLED_FROM_PROPOSAL"
  | "PARTICIPANT_CREATED"
  | "PARTICIPANT_LINK_REGENERATED"
  | "PARTICIPANT_COMPLETED"
  | "PARTICIPANT_PATCH_REJECTED_PATH"
  | "ATTACHMENT_UPLOAD"
  | "ATTACHMENT_DELETE"
  | "ATTACHMENT_EXTRACT"
  | "ATTACHMENT_RECLASSIFY"
  // Newton — Leads (pré-Deal)
  | "LEAD_CREATE"
  | "LEAD_UPDATE"
  | "LEAD_DELETE"
  | "LEAD_CONVERT_TO_DEAL"
  | "LEAD_ATTACHMENT_UPLOAD"
  | "CONTRACT_GENERATE"
  | "CONTRACT_IMPORT"
  | "CONTRACT_REEXTRACT"
  | "CONTRACT_STATUS_UPDATE"
  | "CONTRACT_COMMENT_ADD"
  | "CONTRACT_COMMENT_AI_RESOLVED"
  | "CONTRACT_SUGGESTION_APPLY"
  | "CONTRACT_SUGGESTION_REJECT"
  | "CONTRACT_APPROVE"
  | "CONTRACT_DELETE"
  | "CONTRACT_DELETE_BULK"
  | "CONTRACT_SIGNERS_DATA_UPDATE"
  // Multi-agent — Sentinel blocks
  | "AGENT_TOOL_BLOCKED"
  | "SENTINEL_ATTACHMENT_QUARANTINED"
  | "CERTIDAO_BATCH_DISPATCH"
  | "CERTIDAO_JOB_DELETE"
  | "CERTIDAO_BULK_DELETE"
  // Serasa Experian — consultas restritas (score, restritivos, vínculos).
  // SERASA_QUERY_DISPATCH grava qualquer batch que inclua endpoint Serasa;
  // SERASA_CONSENT_GIVEN registra o consentimento LGPD por deal;
  // SERASA_VINCULOS_EXPAND marca a descoberta opt-in de CNPJs vinculados;
  // SERASA_BUDGET_EXCEEDED captura 402 quando o cap mensal Serasa estoura.
  | "SERASA_QUERY_DISPATCH"
  | "SERASA_CONSENT_GIVEN"
  | "SERASA_VINCULOS_EXPAND"
  | "SERASA_BUDGET_EXCEEDED"
  | "ENVELOPE_CREATE"
  | "ENVELOPE_RESEND"
  | "CLICKSIGN_WEBHOOK_RECEIVED"
  | "CLICKSIGN_WEBHOOK_REJECTED"
  | "CLICKSIGN_WEBHOOK_PROCESSED"
  // ActionIntent (HITL para Bearer high-risk)
  | "INTENT_CREATED"
  | "INTENT_APPROVED"
  | "INTENT_REJECTED"
  | "INTENT_EXECUTED"
  | "INTENT_EXPIRED"
  | "INTENT_TAMPERED"
  // Locação — entidades operacionais (docs/locacao/spec.md §4-§6)
  | "PROPERTY_CREATE"
  | "PROPERTY_UPDATE"
  | "PROPERTY_DELETE"
  | "PROPERTY_OWNERSHIP_UPDATE"
  | "PROPERTY_BULK_UPDATE"
  | "PROPERTY_BULK_EXPORT"
  | "AI_INSIGHTS_CONFIG_UPDATE"
  | "CRON_TOGGLE_UPDATE"
  | "LEASE_CREATE"
  | "LEASE_UPDATE"
  | "LEASE_RENEW"
  | "LEASE_TERMINATE"
  | "LEASE_TENANT_ADD"
  | "LEASE_TENANT_REMOVE"
  | "LEASE_ANGARIADOR_ADD"
  | "LEASE_ANGARIADOR_REMOVE"
  | "RENT_CHARGE_GENERATE"
  | "RENT_CHARGE_CANCEL"
  | "RENT_REMIND"
  | "RENT_MARK_REPASSED"
  | "EXPENSE_CREATE"
  | "EXPENSE_UPDATE"
  | "EXPENSE_DELETE"
  | "EXPENSE_PAY"
  | "CHECKLIST_TEMPLATE_CREATE"
  | "CHECKLIST_TEMPLATE_UPDATE"
  | "CHECKLIST_CREATE"
  | "CHECKLIST_ITEM_TOGGLE"
  | "CHECKLIST_COMPLETE"
  | "DEBT_AGREEMENT_CREATE"
  | "DEBT_AGREEMENT_BREAK"
  | "DEBT_AGREEMENT_COMPLETE"
  | "INSURANCE_CREATE"
  | "INSURANCE_RENEW"
  | "INSURANCE_CANCEL"
  | "INSURANCE_UPDATE"
  | "INSURANCE_DELETE"
  | "INSURANCE_PDF_UPLOAD"
  | "GUARANTEE_CREATE"
  | "GUARANTEE_UPDATE"
  | "GUARANTEE_REPLACE"
  | "GUARANTEE_DOCUMENT_UPLOAD"
  | "INSPECTION_CREATE"
  | "INSPECTION_SCHEDULE"
  | "INSPECTION_COMPLETE"
  | "INSPECTION_UPDATE"
  | "INSPECTION_LAUDO_GENERATED"
  | "INSPECTION_SIGNATURE_SENT"
  | "INSPECTION_SIGNED"
  | "MAINTENANCE_CREATE"
  | "MAINTENANCE_COMPLETE"
  | "MAINTENANCE_CANCEL"
  | "CREDIT_ANALYSIS_REQUESTED"
  | "CREDIT_ANALYSIS_DECIDED"
  // Locação — clientes/prospects (ambiente de cadastro + acompanhamento)
  | "CLIENT_CREATE"
  | "CLIENT_UPDATE"
  | "CLIENT_DELETE"
  | "CLIENT_IMPORT"
  | "CLIENT_CREDIT_DISPATCH"
  | "CLIENT_INSURER_UPSERT"
  | "CLIENT_DOCUMENT_UPLOAD"
  | "TRANSFER_NFSE_REQUESTED"
  | "TRANSFER_NFSE_EMITTED"
  // Newton — pedidos tipados de locação + executor
  | "NEWTON_REQUEST_CREATE"
  | "NEWTON_REQUEST_UPDATE"
  | "NEWTON_REQUEST_FULFILLED"
  | "NEWTON_INTENT_APPROVED"
  | "NEWTON_INTENT_REJECTED"
  // DIMOB / fiscal
  | "FISCAL_SETTINGS_UPDATE"
  | "DIMOB_GENERATED"
  | "DIMOB_SALE_EXCLUDED"
  | "DIMOB_SALE_RECONCILED"
  | "DIMOB_RECONCILED_ALL"
  // Onboarding self-service
  | "ORG_ONBOARDING_COMPLETED"
  | "ORG_ONBOARDING_RESET"
  | "ORG_OWNER_ACCESS_RESENT";

export interface AuditContext {
  // Nullable (Fase 0c): eventos pré-resolução de tenant gravam orgId=null.
  orgId: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  result: AuditResult;
  resource?: string;
  resourceType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Audit log imutável. Fire-and-forget — nunca lança para o caller.
 * Usar await se precisar confirmação, senão chamar sem await em rotas hot path.
 */
export async function audit(
  ctx: AuditContext,
  entry: AuditEntry
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId: ctx.userId ?? null,
        action: entry.action,
        result: entry.result,
        resource: entry.resource ?? null,
        resourceType: entry.resourceType ?? null,
        metadata: (entry.metadata as object) ?? undefined,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 1000) : null,
      },
    });
  } catch (err) {
    // Nunca propagar — audit log é best-effort
    console.error("[audit] failed to persist", {
      action: entry.action,
      result: entry.result,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function extractAuditContextFromRequest(
  req: Request,
  orgId: string,
  userId?: string | null
): AuditContext {
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;
  return { orgId, userId, ipAddress, userAgent };
}
