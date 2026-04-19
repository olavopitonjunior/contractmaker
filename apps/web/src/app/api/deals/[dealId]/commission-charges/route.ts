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
import { upsertCustomer } from "@/lib/asaas/customers";
import {
  createPayment,
  getPixQrCode,
  getBankSlipData,
} from "@/lib/asaas/payments";
import {
  resolvePayer,
  resolveCommissionValue,
  buildCommissionPayload,
  CommissionBuildError,
  type DadosContratoLite,
} from "@/lib/asaas/commission";

const createSchema = z.object({
  billingType: z.enum(["PIX", "BOLETO"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contractId: z.string().optional(),
  description: z.string().optional(),
});

/**
 * POST /api/deals/[dealId]/commission-charges
 * Gera cobrança de comissão vinculada ao deal.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { dealId } = await params;

  // 1. Permission
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CHARGE_CREATE_FROM_DEAL,
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

  // 2. Rate limit
  const rl = await RateLimits.chargesPerOrg(ctx.orgId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: rl.reset },
      { status: 429 }
    );
  }

  // 3. Body
  const raw = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const { billingType, dueDate, contractId, description } = parsed.data;

  // 4. Deal + scope check
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId: ctx.orgId } },
    include: {
      contracts: {
        orderBy: { version: "desc" },
        take: 1,
        where: contractId ? { id: contractId } : { status: "aprovado" },
      },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  // Sales só pode usar próprios deals
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (membership?.role === "sales" && deal.userId !== ctx.userId) {
    // 404 mascarado (não vaza existência)
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  const contract = deal.contracts[0];
  if (!contract) {
    return NextResponse.json(
      { error: "Nenhum contrato aprovado neste deal" },
      { status: 422 }
    );
  }
  if (contract.status !== "aprovado") {
    return NextResponse.json(
      { error: "Contrato precisa estar aprovado" },
      { status: 422 }
    );
  }

  // 5. AsaasAccount APPROVED?
  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: ctx.orgId },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Configure sua conta Asaas em /financeiro/onboarding" },
      { status: 422 }
    );
  }
  if (account.status !== "APPROVED") {
    return NextResponse.json(
      {
        error: "Conta Asaas ainda não aprovada",
        accountStatus: account.status,
      },
      { status: 422 }
    );
  }

  // 6. Duplicate guard — charge ativa no contrato?
  const existingActive = await prisma.commissionCharge.findFirst({
    where: {
      contractId: contract.id,
      status: {
        notIn: ["REFUNDED", "CANCELLED", "CHARGEBACK"],
      },
      cancelledAt: null,
    },
  });
  if (existingActive) {
    return NextResponse.json(
      {
        error: "Já existe cobrança ativa para este contrato",
        existingChargeId: existingActive.id,
        existingStatus: existingActive.status,
      },
      { status: 409 }
    );
  }

  // 7. Build payload — Fase 4: platform fee carregado de OrgFinancialSettings
  const feesSettings = await prisma.orgFinancialSettings.findUnique({
    where: { orgId: ctx.orgId },
  });
  const platformFeePercent = feesSettings?.platformFeePercent ?? 0;
  const platformWalletId =
    feesSettings?.platformFeeWalletId ?? process.env.PLATFORM_WALLET_ID ?? undefined;

  let payer;
  let value;
  let payload;
  try {
    const data = contract.dataJson as unknown as DadosContratoLite;
    payer = resolvePayer(data);
    value = resolveCommissionValue(data);
    payload = buildCommissionPayload({
      contractData: data,
      payer,
      value,
      billingType,
      dueDate,
      description:
        description ??
        `Comissão — ${deal.title} (${payer.papel === "comprador" ? "Comprador" : "Vendedor"})`,
      externalReference: `contract:${contract.id}`,
      orgWalletId: account.walletId,
      // Platform fee (fase 4): só ativa se org configurou e master walletId disponível
      platformFeePercent: platformFeePercent > 0 ? platformFeePercent : undefined,
      platformWalletId:
        platformFeePercent > 0 && platformWalletId ? platformWalletId : undefined,
    });
  } catch (err) {
    if (err instanceof CommissionBuildError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 422 }
      );
    }
    throw err;
  }

  // 8. Decrypt apiKey da subconta
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    // 9. Upsert customer on Asaas
    const asaasCustomer = await upsertCustomer({
      input: payload.customerInput,
      apiKey,
    });

    // Upsert customer local
    const localCustomer = await prisma.asaasCustomer.upsert({
      where: { orgId_cpfCnpj: { orgId: ctx.orgId, cpfCnpj: asaasCustomer.cpfCnpj } },
      create: {
        orgId: ctx.orgId,
        asaasId: asaasCustomer.id,
        name: asaasCustomer.name,
        cpfCnpj: asaasCustomer.cpfCnpj,
        email: asaasCustomer.email ?? null,
        mobilePhone: asaasCustomer.mobilePhone ?? null,
        origin: "deal_sync",
        sourceDealId: deal.id,
        externalReference: asaasCustomer.externalReference ?? null,
        lastSyncedAt: new Date(),
      },
      update: {
        asaasId: asaasCustomer.id,
        name: asaasCustomer.name,
        email: asaasCustomer.email ?? undefined,
        mobilePhone: asaasCustomer.mobilePhone ?? undefined,
        lastSyncedAt: new Date(),
      },
    });

    // 10. Create payment
    const payment = await createPayment({
      input: { customer: asaasCustomer.id, ...payload.paymentInput },
      apiKey,
    });

    // 11. Fetch QR code OU linha digitável
    let pixQr = null;
    let bankSlip = null;
    if (billingType === "PIX") {
      try {
        pixQr = await getPixQrCode({ asaasId: payment.id, apiKey });
      } catch (e) {
        console.warn("[commission-charges] getPixQrCode falhou", e instanceof Error ? e.message : e);
      }
    } else if (billingType === "BOLETO") {
      try {
        bankSlip = await getBankSlipData({ asaasId: payment.id, apiKey });
      } catch (e) {
        console.warn("[commission-charges] getBankSlipData falhou", e instanceof Error ? e.message : e);
      }
    }

    // 12. Persist CommissionCharge
    const charge = await prisma.commissionCharge.create({
      data: {
        orgId: ctx.orgId,
        dealId: deal.id,
        contractId: contract.id,
        asaasCustomerId: localCustomer.id,
        asaasPaymentId: payment.id,
        kind: "commission",
        billingType,
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
        splitJson: (payload.paymentInput.split ?? null) as any,
        payerSnapshot: payer as any,
        beneficiarySnapshot: {
          imobiliaria_nome: (contract.dataJson as any)?.comissao?.imobiliaria_nome ?? null,
          imobiliaria_cnpj: (contract.dataJson as any)?.comissao?.imobiliaria_cnpj ?? null,
          walletId: account.walletId,
        } as any,
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CHARGE_CREATE",
        result: "SUCCESS",
        resourceType: "commission_charge",
        resource: `commission_charge:${charge.id}`,
        metadata: {
          dealId: deal.id,
          contractId: contract.id,
          asaasPaymentId: payment.id,
          value: payment.value,
          billingType,
        },
      }
    );

    return NextResponse.json({
      charge: {
        id: charge.id,
        asaasPaymentId: charge.asaasPaymentId,
        value: charge.value,
        billingType: charge.billingType,
        status: charge.status,
        dueDate: charge.currentDueDate,
        invoiceUrl: charge.invoiceUrl,
        bankSlipUrl: charge.bankSlipUrl,
        identificationField: charge.identificationField,
        pixQrCodePayload: charge.pixQrCodePayload,
        pixQrCodeImage: charge.pixQrCodeImage,
      },
    });
  } catch (err) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CHARGE_CREATE",
        result: "FAILURE",
        metadata: { error: err instanceof Error ? err.message : "unknown" },
      }
    );
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors, status: err.status },
        { status: 422 }
      );
    }
    console.error("[commission-charges]", err);
    return NextResponse.json(
      { error: "Falha ao criar cobrança" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/deals/[dealId]/commission-charges — lista do deal.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { dealId } = await params;

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId: ctx.orgId } },
    select: { id: true, userId: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (membership?.role === "sales" && deal.userId !== ctx.userId) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  const charges = await prisma.commissionCharge.findMany({
    where: { dealId, orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true, cpfCnpj: true, email: true } },
    },
  });

  return NextResponse.json({
    charges: charges.map((c) => ({
      id: c.id,
      asaasPaymentId: c.asaasPaymentId,
      value: c.value,
      netValue: c.netValue,
      billingType: c.billingType,
      status: c.status,
      asaasStatus: c.asaasStatus,
      description: c.description,
      originalDueDate: c.originalDueDate,
      currentDueDate: c.currentDueDate,
      paidAt: c.paidAt,
      cancelledAt: c.cancelledAt,
      refundedAt: c.refundedAt,
      invoiceUrl: c.invoiceUrl,
      bankSlipUrl: c.bankSlipUrl,
      identificationField: c.identificationField,
      pixQrCodePayload: c.pixQrCodePayload,
      pixQrCodeImage: c.pixQrCodeImage,
      customer: c.customer,
      createdAt: c.createdAt,
    })),
  });
}

export const runtime = "nodejs";
export const maxDuration = 30;
