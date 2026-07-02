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
import { RateLimits } from "@/lib/security/ratelimit";
import {
  getAccountWithApiKey,
  resolveAsaasAccount,
} from "@/lib/asaas/account";
import { resolvePlatformFee } from "@/lib/asaas/platform-fee";
import {
  requireAccountCapability,
  AccountCapabilityDeniedError,
} from "@/lib/security/rbac/guard";
import { AsaasError, AsaasConfigError } from "@/lib/asaas/errors";
import {
  createPayment,
  getPixQrCode,
  getBankSlipData,
} from "@/lib/asaas/payments";
import {
  composeSplits,
  CommissionBuildError,
  generatePayerVisibleDescription,
  type SplitDisplay,
} from "@/lib/asaas/commission";
import { notifyChargeEvent } from "@/lib/financeiro/notifications";

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
  /** Conta Asaas que vai emitir a cobrança. Default = conta ativa do user. */
  accountId: z.string().optional(),
  customerId: z.string(), // AsaasCustomer.id local
  billingType: z.enum(["PIX", "BOLETO"]),
  value: z.number().positive(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(500).optional(),
  kind: z.enum(["avulsa", "aluguel", "outros"]).default("avulsa"),
  customSplits: z.array(splitEntrySchema).max(10).optional(),
  // Pagadoria 2026-05-09 — categoria livre + vínculo opcional a deal
  categoryLabel: z.string().max(100).optional(),
  dealId: z.string().optional(),
  display: z
    .object({
      hiddenRecipientIds: z.array(z.string()),
      consolidationMap: z.record(z.string()),
    })
    .optional(),
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

  const resolved = await resolveAsaasAccount({
    userId: ctx.userId,
    orgId: ctx.orgId,
    hintAccountId: parsed.data.accountId,
    requireCapability: "create_charge",
  });
  if (!resolved || resolved.account.status !== "APPROVED") {
    return NextResponse.json(
      {
        error: "Conta Asaas não aprovada",
        accountStatus: resolved?.account.status ?? null,
      },
      { status: 422 }
    );
  }
  try {
    await requireAccountCapability({
      userId: ctx.userId,
      accountId: resolved.account.id,
      capability: "create_charge",
    });
  } catch (err) {
    if (err instanceof AccountCapabilityDeniedError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
  const account = resolved.account;

  // Customer agora é per-conta — busca pelo accountId em vez de orgId.
  const customer = await prisma.asaasCustomer.findFirst({
    where: { id: parsed.data.customerId, accountId: account.id },
  });
  if (!customer) {
    return NextResponse.json(
      { error: "Cliente não encontrado" },
      { status: 404 }
    );
  }

  // Cross-org guard: se dealId vier, valida que pertence à mesma org
  let resolvedDealTitle: string | null = null;
  if (parsed.data.dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: parsed.data.dealId, pipeline: { orgId: ctx.orgId } },
      select: { id: true, title: true },
    });
    if (!deal) {
      return NextResponse.json(
        { error: "Deal não encontrado nesta org" },
        { status: 404 }
      );
    }
    resolvedDealTitle = deal.title ?? null;
  }

  const { apiKey } = await getAccountWithApiKey(account.id);

  // Fase 1d: markup global (PlatformConfig) + override per-org (OrgFinancialSettings).
  const { platformFeePercent, platformWalletId } = await resolvePlatformFee(
    ctx.orgId,
    account.id
  );

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
      platformFeePercent,
      platformWalletId,
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

  // Resolve descrição final aplicando hide-from-payer quando há display block
  const display: SplitDisplay | undefined = parsed.data.display;
  let finalDescription = parsed.data.description;
  if (!finalDescription && (parsed.data.customSplits ?? []).length > 0) {
    finalDescription = generatePayerVisibleDescription({
      splits: parsed.data.customSplits ?? [],
      hiddenRecipientIds: display?.hiddenRecipientIds ?? [],
      dealTitle: resolvedDealTitle,
      kind: parsed.data.kind === "avulsa" ? "avulsa" : parsed.data.kind,
      categoryLabel: parsed.data.categoryLabel ?? null,
    });
  }

  try {
    const payment = await createPayment({
      input: {
        customer: customer.asaasId,
        billingType: parsed.data.billingType,
        value: parsed.data.value,
        dueDate: parsed.data.dueDate,
        description: finalDescription,
        externalReference: parsed.data.dealId
          ? `avulsa:${customer.id}:deal:${parsed.data.dealId}:${Date.now()}`
          : `avulsa:${customer.id}:${Date.now()}`,
        split: asaasSplits,
      },
      apiKey,
    });

    let pixQr = null;
    let bankSlip = null;
    if (parsed.data.billingType === "PIX") {
      try {
        pixQr = await getPixQrCode({ asaasId: payment.id, apiKey });
      } catch (e) {
        // Best-effort: a cobrança já foi criada; QR pode ser buscado depois.
        console.warn("[charges/nova] getPixQrCode falhou", e instanceof Error ? e.message : e);
      }
    } else {
      try {
        bankSlip = await getBankSlipData({ asaasId: payment.id, apiKey });
      } catch (e) {
        console.warn("[charges/nova] getBankSlipData falhou", e instanceof Error ? e.message : e);
      }
    }

    const charge = await prisma.commissionCharge.create({
      data: {
        orgId: ctx.orgId,
        accountId: account.id,
        dealId: parsed.data.dealId ?? null,
        asaasCustomerId: customer.id,
        asaasPaymentId: payment.id,
        kind: parsed.data.kind,
        categoryLabel: parsed.data.categoryLabel ?? null,
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
          asaasSplits || externalSplits.length > 0 || display
            ? ({
                splits: asaasSplits ?? [],
                external: externalSplits,
                display: display ?? undefined,
              } as any)
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
          categoryLabel: parsed.data.categoryLabel ?? null,
          dealId: parsed.data.dealId ?? null,
          billingType: parsed.data.billingType,
          value: payment.value,
          customerId: customer.id,
          customSplitsCount: parsed.data.customSplits?.length ?? 0,
          hiddenSplitsCount: display?.hiddenRecipientIds.length ?? 0,
        },
      }
    );

    waitUntil(
      notifyChargeEvent({
        chargeId: charge.id,
        event: "created",
        orgId: ctx.orgId,
      })
    );

    return NextResponse.json({ charge: { id: charge.id } });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors },
        { status: 422 }
      );
    }
    if (err instanceof AsaasConfigError) {
      return NextResponse.json(
        { error: "ASAAS_CONFIG_ERROR", code: err.code, message: err.message },
        { status: 500 }
      );
    }
    console.error("[charges/nova] uncaught", err);
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Erro desconhecido",
      },
      { status: 500 }
    );
  }
}
