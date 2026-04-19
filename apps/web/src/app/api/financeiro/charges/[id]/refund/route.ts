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
import {
  requireElevation,
  ElevationRequiredError,
} from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";
import { decryptSecret } from "@/lib/security/crypto";
import { AsaasError } from "@/lib/asaas/errors";
import { refundPayment } from "@/lib/asaas/payments";

const bodySchema = z.object({
  value: z.number().positive().optional(),
  description: z.string().max(500).optional(),
});

const LARGE_REFUND_THRESHOLD = 10_000;

/**
 * POST /api/financeiro/charges/[id]/refund
 * Estorna (total ou parcial). Hard cap R$ 10k exige elevation extra.
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
      permission: PERMISSION.CHARGE_REFUND,
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
  if (!["RECEIVED", "CONFIRMED"].includes(charge.status)) {
    return NextResponse.json(
      { error: "Apenas cobranças RECEIVED/CONFIRMED podem ser estornadas" },
      { status: 422 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const refundValue = parsed.data.value ?? charge.value;

  // Refund > R$ 10k exige elevation TRANSFER (dual approval virá em Fase 3)
  if (refundValue > LARGE_REFUND_THRESHOLD) {
    try {
      await requireElevation(ctx.userId, "TRANSFER");
    } catch (err) {
      if (err instanceof ElevationRequiredError) {
        return NextResponse.json(
          { error: "ELEVATION_REQUIRED", scope: "TRANSFER", reason: "large_refund" },
          { status: 403 }
        );
      }
      throw err;
    }
  }

  const account = charge.org.asaasAccount;
  if (!account) return NextResponse.json({ error: "Conta Asaas não configurada" }, { status: 422 });
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    await refundPayment({
      asaasId: charge.asaasPaymentId,
      value: parsed.data.value,
      description: parsed.data.description,
      apiKey,
    });

    const updated = await prisma.commissionCharge.update({
      where: { id: charge.id },
      data: {
        status: "REFUND_PENDING",
        refundedAt: new Date(),
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CHARGE_REFUND",
        result: "SUCCESS",
        resourceType: "commission_charge",
        resource: `commission_charge:${charge.id}`,
        metadata: { refundValue, full: !parsed.data.value },
      }
    );

    return NextResponse.json({ charge: updated });
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
