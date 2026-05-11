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
import { audit } from "@/lib/security/audit";
import { AsaasError } from "@/lib/asaas/errors";
import { markAsReceivedInCash } from "@/lib/asaas/payments";
import { getAccountWithApiKey } from "@/lib/asaas/account";

const bodySchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().positive().optional(),
  notifyCustomer: z.boolean().optional(),
});

/**
 * POST /api/financeiro/charges/[id]/mark-received-in-cash
 * Registra pagamento fora do Asaas (dinheiro, transferência manual).
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
      permission: PERMISSION.CHARGE_MARK_RECEIVED_IN_CASH,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const charge = await prisma.commissionCharge.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!charge) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  if (charge.status !== "PENDING" && charge.status !== "OVERDUE") {
    return NextResponse.json(
      { error: "Apenas cobranças PENDING/OVERDUE podem ser marcadas como pagas em dinheiro" },
      { status: 422 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  let resolvedAccountId = charge.accountId;
  if (!resolvedAccountId) {
    const fallback = await prisma.asaasAccount.findFirst({
      where: { orgId: ctx.orgId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!fallback) {
      return NextResponse.json({ error: "Conta Asaas não configurada" }, { status: 422 });
    }
    resolvedAccountId = fallback.id;
  }
  const { apiKey } = await getAccountWithApiKey(resolvedAccountId);

  try {
    await markAsReceivedInCash({
      asaasId: charge.asaasPaymentId,
      paymentDate: parsed.data.paymentDate,
      value: parsed.data.value ?? charge.value,
      notifyCustomer: parsed.data.notifyCustomer ?? false,
      apiKey,
    });

    const updated = await prisma.commissionCharge.update({
      where: { id: charge.id },
      data: {
        status: "RECEIVED_IN_CASH",
        paidAt: new Date(parsed.data.paymentDate),
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CHARGE_MARK_RECEIVED_IN_CASH",
        result: "SUCCESS",
        resourceType: "commission_charge",
        resource: `commission_charge:${charge.id}`,
        metadata: parsed.data,
      }
    );
    return NextResponse.json({ charge: updated });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json({ error: "ASAAS_ERROR", details: err.errors }, { status: 422 });
    }
    throw err;
  }
}
