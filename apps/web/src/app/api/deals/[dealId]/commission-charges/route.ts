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
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { RateLimits } from "@/lib/security/ratelimit";
import {
  runCreateCommissionCharge,
  buildChargePreview,
} from "@/lib/asaas/charges-action";
import {
  resolveAsaasAccount,
  AccountNotFoundError,
} from "@/lib/asaas/account";
import {
  requireAccountCapability,
  AccountCapabilityDeniedError,
} from "@/lib/security/rbac/guard";
import { requireApproval, approvalResponse } from "@/lib/api/intents";
import { guardDealScope } from "@/lib/deals/route-helpers";

// Discriminated union igual ao /financeiro/charges/nova — extraído inline pra
// evitar import circular; em refactor futuro mover para lib/asaas/zod-splits.ts
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
  billingType: z.enum(["PIX", "BOLETO"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /**
   * Conta Asaas que vai emitir a cobrança. Opcional pra retrocompat — caller
   * sem accountId cai na conta ativa da org.
   */
  accountId: z.string().optional(),
  contractId: z.string().optional(),
  description: z.string().optional(),
  // Pagadoria 2026-05-09 — overrides do wizard
  customSplits: z.array(splitEntrySchema).max(10).optional(),
  payerOverride: z
    .object({
      papel: z.enum(["comprador", "vendedor"]).optional(),
      partyIndex: z.number().int().min(0).optional(),
      nome: z.string().optional(),
      cpfCnpj: z.string().optional(),
      email: z.string().optional().nullable(),
      mobilePhone: z.string().optional().nullable(),
    })
    .optional(),
  valueOverride: z.number().positive().optional(),
  display: z
    .object({
      hiddenRecipientIds: z.array(z.string()),
      consolidationMap: z.record(z.string()),
    })
    .optional(),
  kind: z.enum(["commission", "avulsa", "aluguel", "outros"]).optional(),
  categoryLabel: z.string().max(100).optional(),
});

/**
 * POST /api/deals/[dealId]/commission-charges
 *
 * Cria cobrança de comissão. Session humana → executa direto. Bearer →
 * cria ActionIntent (CHARGE_CREATE) com preview, retorna 202.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireAuth(req, { scope: "charges:rw" });
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

  // 4. Sales-scope guard (deal precisa pertencer ao user se role=sales)
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId: ctx.orgId } },
    select: { id: true, userId: true, title: true },
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

  // 4b. Escopo do gerente — ACRESCENTADO ao gate CHARGE_* acima, não o
  // substitui: a permissão diz "pode cobrar", o escopo diz "deste negócio".
  const denied = await guardDealScope({
    dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    via: ctx.via,
  });
  if (denied) return denied;

  // 5. Bearer → cria intent. Session → executa direto.
  const {
    billingType,
    dueDate,
    accountId: accountIdHint,
    contractId,
    description,
    customSplits,
    payerOverride,
    valueOverride,
    display,
    kind,
    categoryLabel,
  } = parsed.data;
  const idempotencyKey = req.headers.get("x-idempotency-key");

  // 5a. Resolve a conta Asaas que vai emitir a cobrança e checa capability.
  const resolved = await resolveAsaasAccount({
    userId: ctx.userId,
    orgId: ctx.orgId,
    hintAccountId: accountIdHint,
    requireCapability: "create_charge",
  });
  if (!resolved) {
    return NextResponse.json(
      { error: "ACCOUNT_NOT_FOUND", message: "Conta Asaas não encontrada ou inacessível" },
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
      return NextResponse.json({ error: err.code, accountId: err.accountId }, { status: err.status });
    }
    throw err;
  }
  const accountId = resolved.account.id;

  // Pra Bearer, build preview SEM chamar Asaas
  if (ctx.via === "bearer") {
    const preview = await buildChargePreview({
      dealId,
      orgId: ctx.orgId,
      accountId,
      contractId,
      billingType,
      dueDate,
    });
    if ("error" in preview) {
      return NextResponse.json(
        { error: preview.error },
        { status: preview.status }
      );
    }

    const result = await requireApproval<unknown>({
      ctx: {
        via: ctx.via,
        userId: ctx.userId,
        orgId: ctx.orgId,
        actor: ctx.actor,
      },
      action: "CHARGE_CREATE",
      payload: { dealId, billingType, dueDate, contractId, description },
      preview: {
        summary: preview.summary,
        details: preview.details as unknown as Record<string, unknown>,
      },
      req,
      idempotencyKey,
      run: async () => {
        const out = await runCreateCommissionCharge({
          dealId,
          orgId: ctx.orgId,
          accountId,
          userId: ctx.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          billingType,
          dueDate,
          contractId,
          description,
          customSplits,
          payerOverride: payerOverride
            ? {
                ...payerOverride,
                email: payerOverride.email ?? null,
                mobilePhone: payerOverride.mobilePhone ?? null,
              }
            : undefined,
          valueOverride,
          display,
          kind,
          categoryLabel,
          skipAudit: true, // auditamos abaixo com via=newton
        });

        if (out.status >= 200 && out.status < 300) {
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
              resource: `commission_charge:${(out.body.charge as { id: string } | undefined)?.id ?? "unknown"}`,
              metadata: mergeAuditMetadata(
                { dealId, billingType, dueDate },
                ctx.actor
              ),
            }
          );
        }
        return out;
      },
    });
    return approvalResponse(result);
  }

  // Session: executa direto
  const out = await runCreateCommissionCharge({
    dealId,
    orgId: ctx.orgId,
    accountId,
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    billingType,
    dueDate,
    contractId,
    description,
    customSplits,
    payerOverride: payerOverride
      ? {
          ...payerOverride,
          email: payerOverride.email ?? null,
          mobilePhone: payerOverride.mobilePhone ?? null,
        }
      : undefined,
    valueOverride,
    display,
    kind,
    categoryLabel,
  });
  return NextResponse.json(out.body, { status: out.status });
}

/**
 * GET /api/deals/[dealId]/commission-charges — lista do deal.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireAuth(req, { scope: "charges:rw" });
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

  // Escopo do gerente (lista de cobranças do negócio).
  const denied = await guardDealScope({
    dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    via: ctx.via,
  });
  if (denied) return denied;

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
      kind: c.kind,
      categoryLabel: c.categoryLabel,
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
