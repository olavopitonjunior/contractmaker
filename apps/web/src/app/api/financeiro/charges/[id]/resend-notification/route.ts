import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { decryptSecret } from "@/lib/security/crypto";
import { AsaasError } from "@/lib/asaas/errors";
import { resendNotification } from "@/lib/asaas/payments";

/**
 * POST /api/financeiro/charges/[id]/resend-notification
 * Pede ao Asaas para reenviar a notificação ao pagador.
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
      permission: PERMISSION.CHARGE_RESEND_NOTIFICATION,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const charge = await prisma.commissionCharge.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { org: { select: { asaasAccount: true } } },
  });
  if (!charge) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

  const account = charge.org.asaasAccount;
  if (!account) return NextResponse.json({ error: "Conta Asaas não configurada" }, { status: 422 });
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    await resendNotification({ asaasId: charge.asaasPaymentId, apiKey });
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CHARGE_NOTIFICATION_RESEND",
        result: "SUCCESS",
        resourceType: "commission_charge",
        resource: `commission_charge:${charge.id}`,
      }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors },
        { status: 422 }
      );
    }
    throw err;
  }
}
