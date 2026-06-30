/**
 * Dual approval — aprovação dupla para operações de alto valor.
 *
 * Fluxo:
 *  1. Usuário A (finance/admin) inicia operação elegível → createDualApproval()
 *     (persiste payload congelado, status=PENDING, expiresAt=+30min)
 *  2. Emails disparados para todos os admins da org (exceto o iniciador)
 *  3. Segundo admin B abre link → approveDualApproval() após elevation+challenge
 *  4. Execute callback real da operação
 *
 * Payload hash (payloadHash) é re-verificado no momento da execução para
 * detectar tampering.
 */

import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "@/lib/security/crypto";

export type DualApprovalKind =
  | "TRANSFER"
  | "REFUND_LARGE"
  | "SPLIT_CHANGE"
  | "FEES_CHANGE";

const EXPIRATION_MS = 30 * 60 * 1000; // 30min

export function hashApprovalPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload, Object.keys(payload as object).sort());
  return sha256Hex(canonical);
}

export async function createDualApproval(params: {
  orgId: string;
  initiatedBy: string;
  kind: DualApprovalKind;
  payload: Record<string, unknown>;
  amount?: number | null;
  reason?: string | null;
}) {
  const payloadHash = hashApprovalPayload(params.payload);
  return await prisma.dualApproval.create({
    data: {
      orgId: params.orgId,
      initiatedBy: params.initiatedBy,
      kind: params.kind,
      payloadJson: params.payload as any,
      payloadHash,
      amount: params.amount ?? null,
      reason: params.reason ?? null,
      status: "PENDING",
      expiresAt: new Date(Date.now() + EXPIRATION_MS),
    },
  });
}

export type ApprovalResolution = "APPROVED" | "REJECTED";

/**
 * Aprova ou rejeita. Valida que aprover ≠ iniciador e que payloadHash bate
 * com a versão congelada (anti-tampering).
 *
 * Em caso de APPROVED, o caller executa a operação real e chama
 * markDualApprovalExecuted() ao final.
 */
export async function resolveDualApproval(params: {
  approvalId: string;
  approverId: string;
  resolution: ApprovalResolution;
  note?: string | null;
}): Promise<
  | { ok: true; approval: any }
  | {
      ok: false;
      reason:
        | "NOT_FOUND"
        | "ALREADY_RESOLVED"
        | "EXPIRED"
        | "SAME_USER"
        | "PAYLOAD_TAMPERED";
    }
> {
  const approval = await prisma.dualApproval.findUnique({
    where: { id: params.approvalId },
  });
  if (!approval) return { ok: false, reason: "NOT_FOUND" };
  if (approval.status !== "PENDING")
    return { ok: false, reason: "ALREADY_RESOLVED" };
  if (approval.expiresAt < new Date()) {
    await prisma.dualApproval.update({
      where: { id: approval.id },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    });
    return { ok: false, reason: "EXPIRED" };
  }
  if (approval.initiatedBy === params.approverId) {
    return { ok: false, reason: "SAME_USER" };
  }
  // Re-verifica payloadHash contra o congelado
  const rehash = hashApprovalPayload(approval.payloadJson as object);
  if (rehash !== approval.payloadHash) {
    // Tamper detectado — marca como rejected + audit
    await prisma.dualApproval.update({
      where: { id: approval.id },
      data: {
        status: "REJECTED",
        approverId: params.approverId,
        approvalNote: "PAYLOAD_TAMPERED — hash mismatch",
        resolvedAt: new Date(),
      },
    });
    return { ok: false, reason: "PAYLOAD_TAMPERED" };
  }

  // Claim atômico do resolve (guard status=PENDING). Dois aprovadores
  // concorrentes: só um vence; o outro recebe ALREADY_RESOLVED em vez de
  // sobrescrever o approverId (audit perdia quem realmente agiu).
  const claimed = await prisma.dualApproval.updateMany({
    where: { id: approval.id, status: "PENDING" },
    data: {
      status: params.resolution,
      approverId: params.approverId,
      approvalNote: params.note ?? null,
      resolvedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    return { ok: false, reason: "ALREADY_RESOLVED" };
  }
  const updated = await prisma.dualApproval.findUnique({
    where: { id: approval.id },
  });
  return { ok: true, approval: updated };
}

export async function markDualApprovalExecuted(approvalId: string) {
  await prisma.dualApproval.update({
    where: { id: approvalId },
    data: { executedAt: new Date() },
  });
}

export async function listPendingApprovalsForOrg(orgId: string) {
  return prisma.dualApproval.findMany({
    where: { orgId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      initiator: { select: { id: true, name: true, email: true } },
    },
  });
}
