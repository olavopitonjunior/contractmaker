import { prisma } from "@/lib/db/prisma";

export type AuditResult = "SUCCESS" | "FAILURE" | "DENIED";

export type AuditAction =
  // Auth / identidade
  | "LOGIN_ELEVATED"
  | "LOGIN_ELEVATION_FAILED"
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
  | "MEMBER_REMOVED"
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
  // Cobrança
  | "CHARGE_CREATE"
  | "CHARGE_CANCEL"
  | "CHARGE_REFUND"
  | "CHARGE_EDIT"
  | "CHARGE_NOTIFICATION_RESEND"
  | "CHARGE_MARK_RECEIVED_IN_CASH"
  // Transferências
  | "TRANSFER_INIT"
  | "TRANSFER_CONFIRM"
  | "TRANSFER_CANCEL"
  | "TRANSFER_DENIED"
  // Dual approval
  | "DUAL_APPROVAL_CREATED"
  | "DUAL_APPROVAL_APPROVED"
  | "DUAL_APPROVAL_REJECTED"
  | "DUAL_APPROVAL_EXPIRED"
  | "DUAL_APPROVAL_TAMPERED"
  // Taxas / config
  | "FEES_UPDATED"
  | "BRANDING_UPDATED"
  // Segurança geral
  | "SUSPICIOUS_ACTIVITY"
  | "RATE_LIMIT_HIT";

export interface AuditContext {
  orgId: string;
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
