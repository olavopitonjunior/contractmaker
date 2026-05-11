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
import { composeSplits, CommissionBuildError } from "@/lib/asaas/commission";
import { dispatchExternalSplits } from "@/lib/asaas/splitDispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/sandbox/seed-paid-charge
 *
 * Cria uma `CommissionCharge` JÁ COM STATUS RECEIVED diretamente no DB,
 * sem chamar Asaas para emitir o pagamento. Útil quando a subconta sandbox
 * está temporariamente indisponível para emitir cobrança nova mas o
 * splitDispatcher precisa ser validado.
 *
 * Após criar, dispara `dispatchExternalSplits` igualzinho ao webhook
 * PAYMENT_RECEIVED. As transferências PIX externas são criadas (e podem
 * falhar individualmente se a Asaas estiver instável — mas aí o QA vê
 * o estado FAILED + retry).
 *
 * **Hard-stop em produção** — recusa se ASAAS_ENV=production.
 *
 * Body:
 *   {
 *     customerId: string,            // AsaasCustomer.id local
 *     value: number,                 // valor total da cobrança em R$
 *     description?: string,
 *     splits: SplitInputEntry[],     // wallet ou pix_external
 *   }
 */
const splitWalletSchema = z.object({
  recipientType: z.literal("asaas_wallet").default("asaas_wallet"),
  recipientId: z.string().optional(),
  walletId: z.string().trim().min(1),
  label: z.string().optional(),
  percentualValue: z.number().min(0).max(100).optional(),
  fixedValue: z.number().min(0).optional(),
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

const bodySchema = z.object({
  customerId: z.string().min(1),
  value: z.number().positive(),
  description: z.string().max(500).optional(),
  splits: z
    .array(z.discriminatedUnion("recipientType", [splitWalletSchema, splitPixSchema]))
    .min(1)
    .max(10),
});

export async function POST(req: NextRequest) {
  if (process.env.ASAAS_ENV === "production") {
    return NextResponse.json(
      {
        error: "ENDPOINT_DISABLED_IN_PRODUCTION",
        message: "Seed endpoint não disponível em produção real",
      },
      { status: 403 }
    );
  }

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
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { customerId, value, description, splits } = parsed.data;

  // Multi-account: usa a conta ativa da org (sandbox helper)
  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { activeAsaasAccountId: true },
  });
  const account =
    (org?.activeAsaasAccountId
      ? await prisma.asaasAccount.findFirst({
          where: { id: org.activeAsaasAccountId, archivedAt: null },
        })
      : null) ??
    (await prisma.asaasAccount.findFirst({
      where: { orgId: ctx.orgId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    }));
  if (!account) {
    return NextResponse.json(
      { error: "Subconta Asaas não encontrada para esta org" },
      { status: 422 }
    );
  }

  // Customer agora é per-conta
  const customer = await prisma.asaasCustomer.findFirst({
    where: { id: customerId, accountId: account.id },
  });
  if (!customer) {
    return NextResponse.json(
      { error: "Cliente não encontrado" },
      { status: 404 }
    );
  }

  let composed;
  try {
    composed = composeSplits({
      customSplits: splits,
      orgWalletId: account.walletId,
    });
  } catch (err) {
    if (err instanceof CommissionBuildError) {
      return NextResponse.json(
        { error: "SPLIT_INVALID", code: err.code, message: err.message },
        { status: 400 }
      );
    }
    throw err;
  }

  const fakePaymentId = `pay_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();

  // netValue ≈ value − taxa Asaas estimada (R$ 1.99 PIX)
  const estimatedNetValue = Math.max(0, value - 1.99);

  const charge = await prisma.commissionCharge.create({
    data: {
      orgId: ctx.orgId,
      accountId: account.id,
      asaasCustomerId: customer.id,
      asaasPaymentId: fakePaymentId,
      kind: "avulsa",
      billingType: "PIX",
      value,
      netValue: estimatedNetValue,
      originalDueDate: now,
      currentDueDate: now,
      status: "RECEIVED",
      asaasStatus: "RECEIVED",
      paidAt: now,
      lastEventAt: now,
      description: description ?? "[SEED] Cobrança simulada para QA",
      splitJson:
        composed.asaasSplits || composed.externalSplits.length > 0
          ? ({
              splits: composed.asaasSplits ?? [],
              external: composed.externalSplits,
            } as any)
          : null,
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
        seedMode: true,
        fakePaymentId,
        value,
        externalSplitsCount: composed.externalSplits.length,
      },
    }
  );

  // Dispara dispatcher idêntico ao webhook PAYMENT_RECEIVED
  const dispatch = await dispatchExternalSplits(charge.id);

  return NextResponse.json(
    {
      ok: true,
      chargeId: charge.id,
      asaasPaymentId: fakePaymentId,
      dispatch,
    },
    { status: 201 }
  );
}
