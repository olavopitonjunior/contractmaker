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
import { decryptSecret } from "@/lib/security/crypto";
import { AsaasError } from "@/lib/asaas/errors";
import { cancelPayment, updatePayment } from "@/lib/asaas/payments";

async function loadCharge(chargeId: string, orgId: string, userId: string) {
  const charge = await prisma.commissionCharge.findFirst({
    where: { id: chargeId, orgId },
    include: {
      customer: true,
      deal: { select: { id: true, title: true, userId: true } },
      contract: { select: { id: true, version: true, status: true } },
      events: {
        orderBy: { receivedAt: "desc" },
        take: 50,
      },
      org: { select: { asaasAccount: true } },
    },
  });
  if (!charge) return null;
  // Sales scope
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (membership?.role === "sales" && charge.deal?.userId !== userId) {
    return null;
  }
  return charge;
}

/**
 * GET /api/financeiro/charges/[id] — detalhe + timeline de eventos.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  const charge = await loadCharge(id, ctx.orgId, ctx.userId);
  if (!charge) {
    return NextResponse.json({ error: "Cobrança não encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    charge: {
      id: charge.id,
      asaasPaymentId: charge.asaasPaymentId,
      value: charge.value,
      netValue: charge.netValue,
      billingType: charge.billingType,
      kind: charge.kind,
      status: charge.status,
      asaasStatus: charge.asaasStatus,
      description: charge.description,
      originalDueDate: charge.originalDueDate,
      currentDueDate: charge.currentDueDate,
      paidAt: charge.paidAt,
      cancelledAt: charge.cancelledAt,
      refundedAt: charge.refundedAt,
      invoiceUrl: charge.invoiceUrl,
      bankSlipUrl: charge.bankSlipUrl,
      identificationField: charge.identificationField,
      pixQrCodePayload: charge.pixQrCodePayload,
      pixQrCodeImage: charge.pixQrCodeImage,
      splitJson: charge.splitJson,
      payerSnapshot: charge.payerSnapshot,
      beneficiarySnapshot: charge.beneficiarySnapshot,
      customer: charge.customer,
      deal: charge.deal,
      contract: charge.contract,
      createdAt: charge.createdAt,
      updatedAt: charge.updatedAt,
    },
    events: charge.events.map((e) => ({
      id: e.id,
      asaasEventId: e.asaasEventId,
      event: e.event,
      receivedAt: e.receivedAt,
      processedAt: e.processedAt,
    })),
  });
}

const patchSchema = z
  .object({
    value: z.number().positive().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().max(500).optional(),
  })
  .refine(
    (d) => d.value !== undefined || d.dueDate !== undefined || d.description !== undefined,
    { message: "Informe ao menos um campo (value, dueDate, description)" }
  );

// Asaas mínimo: R$ 5,00 em produção, R$ 1,00 em sandbox
const ASAAS_MIN_VALUE =
  (process.env.ASAAS_ENV ?? "sandbox") === "production" ? 5 : 1;

/**
 * PATCH /api/financeiro/charges/[id] — altera dueDate ou description.
 */
export async function PATCH(
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
      permission: PERMISSION.CHARGE_EDIT_DUE_DATE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const charge = await loadCharge(id, ctx.orgId, ctx.userId);
  if (!charge) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  if (charge.status !== "PENDING" && charge.status !== "OVERDUE") {
    return NextResponse.json(
      { error: "Apenas cobranças PENDING/OVERDUE podem ser editadas" },
      { status: 422 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  if (parsed.data.value !== undefined && parsed.data.value < ASAAS_MIN_VALUE) {
    return NextResponse.json(
      {
        error: "VALUE_BELOW_MIN",
        message: `Valor mínimo da cobrança é R$ ${ASAAS_MIN_VALUE.toFixed(2).replace(".", ",")}.`,
      },
      { status: 400 }
    );
  }

  const account = charge.org.asaasAccount;
  if (!account) {
    return NextResponse.json({ error: "Conta Asaas não configurada" }, { status: 422 });
  }
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    await updatePayment({
      asaasId: charge.asaasPaymentId,
      fields: {
        value: parsed.data.value,
        dueDate: parsed.data.dueDate,
        description: parsed.data.description,
      },
      apiKey,
    });

    const updated = await prisma.commissionCharge.update({
      where: { id: charge.id },
      data: {
        value: parsed.data.value ?? undefined,
        currentDueDate: parsed.data.dueDate
          ? new Date(parsed.data.dueDate)
          : undefined,
        description: parsed.data.description ?? undefined,
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CHARGE_EDIT",
        result: "SUCCESS",
        resourceType: "commission_charge",
        resource: `commission_charge:${charge.id}`,
        metadata: parsed.data,
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

/**
 * DELETE /api/financeiro/charges/[id] — cancela cobrança.
 */
export async function DELETE(
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
      permission: PERMISSION.CHARGE_CANCEL,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const charge = await loadCharge(id, ctx.orgId, ctx.userId);
  if (!charge) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  if (charge.status !== "PENDING" && charge.status !== "OVERDUE") {
    return NextResponse.json(
      { error: "Apenas cobranças PENDING/OVERDUE podem ser canceladas" },
      { status: 422 }
    );
  }

  const account = charge.org.asaasAccount;
  if (!account) {
    return NextResponse.json({ error: "Conta Asaas não configurada" }, { status: 422 });
  }
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    await cancelPayment({ asaasId: charge.asaasPaymentId, apiKey });
    const updated = await prisma.commissionCharge.update({
      where: { id: charge.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CHARGE_CANCEL",
        result: "SUCCESS",
        resourceType: "commission_charge",
        resource: `commission_charge:${charge.id}`,
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
