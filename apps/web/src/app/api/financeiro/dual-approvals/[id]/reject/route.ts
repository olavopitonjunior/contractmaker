import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { resolveDualApproval } from "@/lib/security/rbac/dualApproval";
import { sendEmail } from "@/lib/email/client";
import { DualApprovalResolvedEmail } from "@/lib/email/templates/dual-approval-resolved";
import { emitDualApprovalResolvedNotif } from "@/lib/financeiro/notifications";

const bodySchema = z.object({
  note: z.string().min(3).max(500),
});

/**
 * POST /api/financeiro/dual-approvals/[id]/reject
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
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Nota obrigatória (3-500 chars)" },
      { status: 400 }
    );
  }

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
    resolution: "REJECTED",
    note: parsed.data.note,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "DUAL_APPROVAL_REJECTED",
      result: "SUCCESS",
      resourceType: "dual_approval",
      resource: `dual_approval:${id}`,
      metadata: { kind: existing.kind, reason: parsed.data.note },
    }
  );

  // waitUntil: um `promise.catch()` cru é cancelado quando a função serverless
  // congela após a resposta — o e-mail/notificação nunca saía.
  waitUntil(sendEmail({
    to: existing.initiator.email,
    subject: `Sua operação ${existing.kind} foi rejeitada`,
    react: DualApprovalResolvedEmail({
      initiatorName: existing.initiator.name ?? "Usuário",
      approverName: ctx.userName,
      kind: existing.kind,
      resolution: "REJECTED",
      note: parsed.data.note,
    }) as any,
  }).catch((e) => console.error("[dual-approval] email falhou:", e)));

  waitUntil(emitDualApprovalResolvedNotif({
    approvalId: id,
    orgId: ctx.orgId,
    initiatorUserId: existing.initiatedBy,
    approverName: ctx.userName,
    kind: existing.kind,
    resolution: "REJECTED",
    note: parsed.data.note,
  }).catch((e) => console.error("[dual-approval] notif falhou:", e)));

  return NextResponse.json({ approval: result.approval });
}
