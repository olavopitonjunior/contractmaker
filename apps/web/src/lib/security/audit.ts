import { prisma } from "@/lib/db/prisma";

export type AuditResult = "SUCCESS" | "FAILURE" | "DENIED";

export type AuditAction =
  // Auth / identidade
  //
  // LOGIN_SUCCESS entrou tarde (2026-08): até então só elevação e logout
  // eram auditados — "quem entrou e quando" não existia em lugar nenhum.
  // Gravado no callback jwt do NextAuth (momento do login, credentials e
  // magic link), fire-and-forget.
  | "LOGIN_SUCCESS"
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
  // Recusa do teto de papel no PATCH de membro (#488). Ação PRÓPRIA e não
  // `MEMBER_ROLE_CHANGED` com `result: "DENIED"`: o painel de auditoria agrupa
  // `topActions` só por `action` (`api/admin/metrics/audit`), então a tentativa
  // negada entraria na contagem de trocas efetivadas. Com ação própria, buscar
  // por ação E buscar por resultado funcionam; reaproveitando, só a segunda.
  | "MEMBER_ROLE_CHANGE_DENIED"
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
  // Dono da imobiliaria ativou/reconectou o Max por conta propria
  // (POST /api/org/max/activate), sem passar pelo painel de plataforma.
  | "ORG_MAX_ACTIVATED"
  | "ORG_SUSPENDED"
  | "ORG_REACTIVATED"
  | "ORG_DELETED"
  | "ORG_BRANDING_UPDATED"
  // Operador ativou modelo com dado pessoal literal no texto (`allowPii`).
  | "TEMPLATE_ACTIVATE_WITH_PII"
  // Edição cirúrgica no Doc-modelo feita pelo app (trocar chave, remover sobra
  // do titular, restaurar parágrafo engolido). O Doc é a fonte do texto
  // contratual e o histórico de versões do Drive não diz QUEM pediu a edição
  // nem por quê — sem esta linha, uma cláusula alterada não tem autor.
  | "TEMPLATE_DOC_EDIT"
  // Trecho literal trocado por chave de preenchimento (painel de mapeamento).
  | "TEMPLATE_FIELD_MAPPED"
  // Slots de cláusula reaplicados a partir do plano do lote (botão "Tentar de novo").
  | "TEMPLATE_SLOTS_REAPPLIED"
  // Propostas da revisão por IA que o operador MARCOU e mandou aplicar no
  // Doc-modelo. A proposta em si não é auditada (é leitura + chamada de modelo,
  // com custo em AIUsage); a escrita, sim — com quem confirmou e o que entrou.
  | "TEMPLATE_AI_PROPOSALS_APPLIED"
  | "ORG_FEES_UPDATED"
  // iList/RexAPI (integração RE/MAX) — provisioning super-admin + sync + import
  | "ILIST_CONNECTION_UPDATED"
  | "ILIST_CONNECTION_REMOVED"
  | "ILIST_SYNC_RUN"
  | "ILIST_LISTING_IMPORTED"
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
  // Gerente do negócio (2026-07)
  | "DEAL_MANAGER_ASSIGN"
  | "ORG_MANAGER_SETTINGS_UPDATE"
  // Política de SLA por stage (plano 2026-08, Fase 3)
  | "ORG_SLA_POLICY_UPDATE"
  | "ORG_SLA_POLICY_RESET"
  // Export CSV do relatório do pipeline (PR 3.7)
  | "REPORT_EXPORTED"
  // Export CSV do log de auditoria (1f)
  | "AUDIT_LOG_EXPORTED"
  | "FORM_CREATE"
  | "FORM_UPDATE"
  | "FORM_PATCH_REJECTED_PATH"
  | "FORM_PATCH_BLANK_ARRAY_SKIPPED"
  | "FORM_SETTINGS_UPDATE"
  // Notificações do processo → corretores (2026-07)
  | "NOTIFICATION_SETTINGS_UPDATED"
  | "DEAL_NOTIFICATION_OVERRIDE_UPDATED"
  // Canal externo das notificações do sistema → usuário (opt-in LGPD)
  | "USER_NOTIFICATION_PREFS_UPDATE"
  | "FORM_REMINDER_SENT"
  | "FORM_SUMMARY_SENT"
  | "FORM_PREFILLED_FROM_PROPOSAL"
  | "FORM_LINK_ROTATED"
  | "FORM_LOCKED"
  | "FORM_UNLOCKED"
  | "FORM_REOPENED"
  | "CONTRACT_SETTINGS_UPDATE"
  | "PARTICIPANT_CREATED"
  | "PARTICIPANT_LINK_REGENERATED"
  | "PARTICIPANT_COMPLETED"
  | "PARTICIPANT_PATCH_REJECTED_PATH"
  // Categorias de terceiro (links por parte com campos customizáveis)
  | "PARTICIPANT_CATEGORY_CREATED"
  | "PARTICIPANT_CATEGORY_UPDATED"
  | "PARTICIPANT_CATEGORY_DELETED"
  // Catálogo de garantias locatícias da org (tipo × garantidor)
  | "GARANTIA_OPTION_CREATED"
  | "GARANTIA_OPTION_UPDATED"
  | "GARANTIA_OPTION_DELETED"
  | "ATTACHMENT_UPLOAD"
  | "ATTACHMENT_DELETE"
  | "ATTACHMENT_EXTRACT"
  | "ATTACHMENT_RECLASSIFY"
  // Restauração de anexo a partir de `DeletedAttachment`.
  | "ATTACHMENT_RESTORE"
  // Anexo do FORMULÁRIO. Não existiam: o DELETE da rota pública apagava
  // documento sem escrever nada, então "sumiu um documento" era inauditável.
  | "FORM_ATTACHMENT_UPLOAD"
  | "FORM_ATTACHMENT_DELETE"
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
  // Análise de crédito na proposta (Ficha Certa Digital, conta por org).
  // CREDIT_ANALYSIS_DISPATCH grava o disparo (request + N jobs);
  // CREDIT_CONSENT_GIVEN o consentimento LGPD na proposta;
  // CREDIT_WEBHOOK_RECEIVED/REJECTED o webhook do laudo (auth ok / recusado);
  // CREDIT_ACCOUNT_CONNECTED/DISCONNECTED a conta em Integrações;
  // CREDIT_BUDGET_EXCEEDED o 402 do teto mensal ou sem créditos pré-pagos.
  | "CREDIT_ANALYSIS_DISPATCH"
  | "CREDIT_CONSENT_GIVEN"
  | "CREDIT_WEBHOOK_RECEIVED"
  | "CREDIT_WEBHOOK_REJECTED"
  | "CREDIT_ACCOUNT_CONNECTED"
  | "CREDIT_ACCOUNT_DISCONNECTED"
  | "CREDIT_BUDGET_EXCEEDED"
  | "ENVELOPE_CREATE"
  | "ENVELOPE_RESEND"
  | "CLICKSIGN_WEBHOOK_RECEIVED"
  | "CLICKSIGN_WEBHOOK_REJECTED"
  | "CLICKSIGN_WEBHOOK_PROCESSED"
  | "CLICKSIGN_ACCOUNT_CONNECTED"
  | "CLICKSIGN_ACCOUNT_DISCONNECTED"
  | "CLICKSIGN_SETTINGS_UPDATED"
  // Propostas (vendas + locação)
  | "PROPOSAL_CREATE"
  | "PROPOSAL_UPDATE"
  | "PROPOSAL_SEND"
  | "PROPOSAL_CANCEL"
  | "PROPOSAL_REACTIVATE"
  | "PROPOSAL_EXPIRED"
  | "PROPOSAL_REFUSED"
  | "PROPOSAL_CONVERT"
  | "PROPOSAL_CONVERTED_UNSIGNED"
  | "PROPOSAL_DUPLICATE"
  | "PROPOSAL_TRANSFER"
  | "PROPOSAL_BUDGET_EXCEEDED"
  | "PROPOSAL_HIDDEN_FIELDS_CHANGED"
  | "PROPOSAL_DELETE"
  | "PROPOSAL_REMIND"
  | "PROPOSAL_ASSIGN"
  | "PROPOSAL_RENAME"
  | "PROPOSAL_SEND_COUNTERPARTY"
  | "PROPOSAL_COMPLETE"
  // Pesquisas de satisfação (NPS/CSAT)
  | "SURVEY_TEMPLATE_CREATE"
  | "SURVEY_TEMPLATE_NEW_VERSION"
  | "SURVEY_TEMPLATE_ARCHIVE"
  | "SURVEY_AUTOMATION_UPSERT"
  | "SURVEY_AUTOMATION_DELETE"
  | "SURVEY_INVITE_CREATED"
  | "SURVEY_INVITE_SENT"
  | "SURVEY_RESPONSE_RECEIVED"
  | "SURVEY_OPTOUT"
  | "SURVEY_SUMMARY_GENERATED"
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
  | "INSPECTION_LAUDO_UPLOADED"
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
  // Identidade visual da imobiliária (BrandingSettings — fonte canônica)
  | "ORG_BRANDING_UPDATE"
  // DIMOB / fiscal
  | "FISCAL_SETTINGS_UPDATE"
  | "AGENT_CONFIG_UPDATE"
  // Agente externo (Max) reportou custo via POST /api/agents/usage — era a
  // única rota M2M de escrita sem rastro, e escreve numa tabela que alimenta
  // teto por agente.
  | "AGENT_USAGE_REPORTED"
  // Base de conhecimento da PLATAFORMA (KnowledgeItem.orgId IS NULL) — escrita
  // que todos os tenants passam a ler, feita por super_admin fora de qualquer org.
  | "PLATFORM_KNOWLEDGE_CREATE"
  | "PLATFORM_KNOWLEDGE_UPDATE"
  | "PLATFORM_KNOWLEDGE_DELETE"
  // Base de conhecimento do TENANT — não era auditada (só a de plataforma
  // tinha ação). O conteúdo daqui alimenta o que a IA responde e insere em
  // contrato; quem mudou o quê importa tanto quanto na plataforma.
  | "KNOWLEDGE_CREATE"
  | "KNOWLEDGE_UPDATE"
  | "KNOWLEDGE_DELETE"
  // Imobiliária adotou o texto de uma cláusula de slot da plataforma na sua.
  // Escrita org-scoped, mas o conteúdo passa a vir de fora — vale rastro.
  | "CLAUSE_ADOPT_PLATFORM"
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
 * Prefixos de ação que significam "uma integração externa falhou pro
 * usuário" — o recorte que vira alerta imediato pro dono da plataforma.
 * DENIED fica fora de propósito: negação de authz é o sistema funcionando.
 */
const INTEGRATION_ALERT_PREFIXES = [
  "CLICKSIGN_",
  "ENVELOPE_",
  "KYC_",
  "CHARGE_",
  "TRANSFER_",
  "CERTIDAO_",
  "SERASA_",
  "ACCOUNT_",
] as const;

export function isIntegrationAction(action: string): boolean {
  return INTEGRATION_ALERT_PREFIXES.some((p) => action.startsWith(p));
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
    // Impersonation de tenant: o `userId` gravado é o ator EFETIVO (dono do
    // tenant). Sem este carimbo, a ação do super_admin ficaria indistinguível
    // de uma ação do próprio dono. Import dinâmico pra não puxar next/headers
    // (nem o ciclo audit→impersonation) em contexto de cron/script.
    let metadata = entry.metadata;
    try {
      const { getImpersonationAuditMeta } = await import("@/lib/auth/impersonation");
      const imp = await getImpersonationAuditMeta();
      if (imp && (ctx.orgId == null || ctx.orgId === imp.orgId)) {
        metadata = {
          ...(metadata ?? {}),
          impersonated: true,
          impersonatedBy: imp.adminUserId,
          impersonationSessionId: imp.sessionId,
        };
      }
    } catch {
      // Fora de request scope (cron/webhook) ou falha de leitura — segue sem carimbo.
    }

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId: ctx.userId ?? null,
        action: entry.action,
        result: entry.result,
        resource: entry.resource ?? null,
        resourceType: entry.resourceType ?? null,
        metadata: (metadata as object) ?? undefined,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 1000) : null,
      },
    });

    // Gatilho do motor de alerta: FAILURE de integração vira alerta pro dono
    // da plataforma. AQUI porque o audit() é o único chokepoint por onde toda
    // falha de integração já passa — instrumentar os N call-sites um a um
    // deixaria buraco no primeiro esquecido. Import dinâmico + fire-and-forget:
    // alerta quebrado não pode quebrar o audit, e o módulo de alerta puxa o
    // client de e-mail que nem todo caller do audit precisa carregar.
    if (entry.result === "FAILURE" && isIntegrationAction(entry.action)) {
      import("@/lib/alerts/platform-alerts")
        .then(({ reportPlatformAlert }) =>
          reportPlatformAlert({
            kind: "integration_failure",
            signature: `${entry.action}:${ctx.orgId ?? "platform"}`,
            orgId: ctx.orgId ?? null,
            severity: "warning",
            title: `Integração falhando: ${entry.action}`,
            payload: { resource: entry.resource ?? null },
            notify: "immediate",
          })
        )
        .catch(() => {});
    }
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
