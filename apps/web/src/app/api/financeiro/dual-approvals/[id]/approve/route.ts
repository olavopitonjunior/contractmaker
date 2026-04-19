import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { requireElevation, ElevationRequiredError } from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";
import { resolveDualApproval } from "@/lib/security/rbac/dualApproval";
import { sendEmail } from "@/lib/email/client";
import { DualApprovalResolvedEmail } from "@/lib/email/templates/dual-approval-resolved";
import { emitDualApprovalResolvedNotif } from "@/lib/financeiro/notifications";

const bodySchema = z.object({
  note: z.string().max(500).optional(),
});

/**
 * POST /api/financeiro/dual-approvals/[id]/approve
 *
 * Exige:
 *  - permission TRANSFER_DUAL_APPROVE (owner ou admin)
 *  - elevation TRANSFER (senha + 2FA recente)
 *  - approver ≠ initiator
 *  - payloadHash ainda bate (anti-tampering)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.TRANSFER_DUAL_APPROVE,
    });
    await requireElevation(ctx.userId, "TRANSFER");
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError ||
      err instanceof ElevationRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // Verify approval belongs to org before resolving
  const existing = await prisma.dualApproval.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      initiator: { select: { id: true, name: true, email: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

  const result = await resolveDualApproval({
    approvalId: id,
    approverId: ctx.userId,
    resolution: "APPROVED",
    note: parsed.data.note,
  });

  if (!result.ok) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action:
          result.reason === "PAYLOAD_TAMPERED"
            ? "DUAL_APPROVAL_TAMPERED"
            : "DUAL_APPROVAL_APPROVED",
        result: "FAILURE",
        resourceType: "dual_approval",
        resource: `dual_approval:${id}`,
        metadata: { reason: result.reason },
      }
    );
    const status =
      result.reason === "EXPIRED"
        ? 410
        : result.reason === "SAME_USER"
        ? 403
        : result.reason === "NOT_FOUND"
        ? 404
        : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "DUAL_APPROVAL_APPROVED",
      result: "SUCCESS",
      resourceType: "dual_approval",
      resource: `dual_approval:${id}`,
      metadata: { kind: existing.kind, amount: existing.amount },
    }
  );

  // Notifica iniciador (fire-and-forget)
  sendEmail({
    to: existing.initiator.email,
    subject: `Sua operação ${existing.kind} foi aprovada`,
    react: DualApprovalResolvedEmail({
      initiatorName: existing.initiator.name ?? "Usuário",
      approverName: ctx.userName,
      kind: existing.kind,
      resolution: "APPROVED",
      note: parsed.data.note,
    }) as any,
  }).catch((e) => console.error("[dual-approval] email falhou:", e));

  emitDualApprovalResolvedNotif({
    approvalId: id,
    orgId: ctx.orgId,
    initiatorUserId: existing.initiatedBy,
    approverName: ctx.userName,
    kind: existing.kind,
    resolution: "APPROVED",
    note: parsed.data.note,
  }).catch((e) => console.error("[dual-approval] notif falhou:", e));

  return NextResponse.json({ approval: result.approval });
}
