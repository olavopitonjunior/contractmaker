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
import { RateLimits } from "@/lib/security/ratelimit";
import { AsaasError } from "@/lib/asaas/errors";
import {
  createPayment,
  getPixQrCode,
  getBankSlipData,
} from "@/lib/asaas/payments";
import { composeSplits, CommissionBuildError } from "@/lib/asaas/commission";

// Fase 6: discriminated union — wallet Asaas (split nativo) OU PIX externo (post-payment dispatch)
const splitWalletSchema = z.object({
  recipientType: z.literal("asaas_wallet").default("asaas_wallet"),
  recipientId: z.string().optional(),
  walletId: z.string().trim().min(1),
  label: z.string().optional(),
  percentualValue: z.number().min(0).max(100).optional(),
  fixedValue: z.number().min(0).optional(),
  totalFixedValue: z.number().min(0).optional(),
});

const splitPixSchema = z.object({
  recipientType: z.literal("pix_external"),
  recipientId: z.string().min(1),
  pixAddressKey: z.string().trim().min(1),
  pixKeyType: z.string().trim().min(1),
  ownerName: z.string().trim().min(1),
  ownerCpfCnpj: z.string().trim().min(11),
  label: z.string().optional(),
  percentualValue: z.number().min(0).max(100).optional(),
  fixedValue: z.number().min(0).optional(),
});

const splitEntrySchema = z.discriminatedUnion("recipientType", [
  splitWalletSchema,
  splitPixSchema,
]);

const createSchema = z.object({
  customerId: z.string(), // AsaasCustomer.id local
  billingType: z.enum(["PIX", "BOLETO"]),
  value: z.number().positive(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(500).optional(),
  kind: z.enum(["avulsa", "aluguel", "outros"]).default("avulsa"),
  customSplits: z.array(splitEntrySchema).max(10).optional(),
});

/**
 * POST /api/financeiro/charges/nova — cria cobrança avulsa.
 * Sem vínculo a Deal/Contract. Exige CHARGE_CREATE_AVULSA (finance ou admin).
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CHARGE_CREATE_AVULSA,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const rl = await RateLimits.chargesPerOrg(ctx.orgId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: rl.reset },
      { status: 429 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: ctx.orgId },
  });
  if (!account || account.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Conta Asaas não aprovada" },
      { status: 422 }
    );
  }

  const customer = await prisma.asaasCustomer.findFirst({
    where: { id: parsed.data.customerId, orgId: ctx.orgId },
  });
  if (!customer) {
    return NextResponse.json(
      { error: "Cliente não encontrado" },
      { status: 404 }
    );
  }

  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  // Carrega platform fee da org (Fase 3 continua ativo para avulsas)
  const feeSettings = await prisma.orgFinancialSettings.findUnique({
    where: { orgId: ctx.orgId },
  });

  let asaasSplits;
  let externalSplits: Array<{
    recipientId: string;
    pixAddressKey: string;
    pixKeyType: string;
    ownerName: string;
    ownerCpfCnpj: string;
    label?: string;
    percentualValue?: number;
    fixedValue?: number;
  }> = [];
  try {
    const composed = composeSplits({
      customSplits: parsed.data.customSplits,
      platformFeePercent: feeSettings?.platformFeePercent ?? 0,
      platformWalletId: feeSettings?.platformFeeWalletId ?? null,
      orgWalletId: account.walletId,
    });
    asaasSplits = composed.asaasSplits;
    externalSplits = composed.externalSplits;
  } catch (err) {
    if (err instanceof CommissionBuildError) {
      return NextResponse.json(
        { error: "SPLIT_INVALID", code: err.code, message: err.message },
        { status: 400 }
      );
    }
    throw err;
  }

  try {
    const payment = await createPayment({
      input: {
        customer: customer.asaasId,
        billingType: parsed.data.billingType,
        value: parsed.data.value,
        dueDate: parsed.data.dueDate,
        description: parsed.data.description,
        externalReference: `avulsa:${customer.id}:${Date.now()}`,
        split: asaasSplits,
      },
      apiKey,
    });

    let pixQr = null;
    let bankSlip = null;
    if (parsed.data.billingType === "PIX") {
      try {
        pixQr = await getPixQrCode({ asaasId: payment.id, apiKey });
      } catch {}
    } else {
      try {
        bankSlip = await getBankSlipData({ asaasId: payment.id, apiKey });
      } catch {}
    }

    const charge = await prisma.commissionCharge.create({
      data: {
        orgId: ctx.orgId,
        asaasCustomerId: customer.id,
        asaasPaymentId: payment.id,
        kind: parsed.data.kind,
        billingType: parsed.data.billingType,
        value: payment.value,
        originalDueDate: new Date(payment.dueDate),
        currentDueDate: new Date(payment.dueDate),
        status: "PENDING",
        asaasStatus: payment.status,
        description: payment.description ?? null,
        invoiceUrl: payment.invoiceUrl ?? null,
        bankSlipUrl: payment.bankSlipUrl ?? bankSlip?.bankSlipUrl ?? null,
        identificationField: bankSlip?.identificationField ?? null,
        pixQrCodePayload: pixQr?.payload ?? null,
        pixQrCodeImage: pixQr?.encodedImage ?? null,
        splitJson:
          asaasSplits || externalSplits.length > 0
            ? ({ splits: asaasSplits ?? [], external: externalSplits } as any)
            : null,
      },
    });

    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "CHARGE_CREATE",
        result: "SUCCESS",
        resourceType: "commission_charge",
        resource: `commission_charge:${charge.id}`,
        metadata: {
          kind: parsed.data.kind,
          billingType: parsed.data.billingType,
          value: payment.value,
          customerId: customer.id,
        },
      }
    );

    return NextResponse.json({ charge: { id: charge.id } });
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
