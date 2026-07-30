import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { resolvePlatformFee } from "@/lib/asaas/platform-fee";
import { guardDealScope } from "@/lib/deals/route-helpers";
import {
  validatePayer,
  validateCharge,
  validateSplits,
  type ValidationResult,
} from "@/lib/asaas/charge-validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/commission-charges/validate?step=payer|charge|splits|all
 *
 * Validação stateless por etapa do ChargeWizard. UI chama ao mudar de etapa
 * pra atualizar StepStatus (chips stateful) e mostrar warnings inline.
 */

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

const bodySchema = z.object({
  payer: z
    .object({
      nome: z.string().optional(),
      cpfCnpj: z.string().optional(),
      email: z.string().nullable().optional(),
      mobilePhone: z.string().nullable().optional(),
    })
    .optional(),
  charge: z
    .object({
      billingType: z.enum(["PIX", "BOLETO"]).optional(),
      value: z.number().optional(),
      dueDate: z.string().optional(),
    })
    .optional(),
  splits: z
    .object({
      customSplits: z.array(splitEntrySchema).optional(),
      display: z
        .object({
          hiddenRecipientIds: z.array(z.string()),
          consolidationMap: z.record(z.string()),
        })
        .optional(),
    })
    .optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireAuth(req, { scope: "charges:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { dealId } = await params;

  // Escopo do gerente — o validate lê dados do negócio pra montar o wizard.
  const denied = await guardDealScope({
    dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    via: ctx.via,
  });
  if (denied) return denied;

  const url = new URL(req.url);
  const step = url.searchParams.get("step") ?? "all";

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // Multi-account: aceita ?accountId= como hint, default = ativa do user.
  const accountIdHint = url.searchParams.get("accountId");
  const { resolveAsaasAccount } = await import("@/lib/asaas/account");
  const resolved = await resolveAsaasAccount({
    userId: ctx.userId,
    orgId: ctx.orgId,
    hintAccountId: accountIdHint,
    requireCapability: "view",
  });
  const account = resolved?.account ?? null;
  // Fase 1d: markup global (PlatformConfig) + override per-org. Mantém validate
  // consistente com a criação da cobrança (charges-action / nova).
  const platformFee = await resolvePlatformFee(ctx.orgId, account?.id ?? null);

  const results: Record<string, ValidationResult> = {};

  if (step === "payer" || step === "all") {
    results.payer = validatePayer({
      ...parsed.data.payer,
      billingType: parsed.data.charge?.billingType,
    });
  }
  if (step === "charge" || step === "all") {
    results.charge = validateCharge(parsed.data.charge ?? {});
  }
  if (step === "splits" || step === "all") {
    results.splits = validateSplits({
      customSplits: parsed.data.splits?.customSplits,
      display: parsed.data.splits?.display,
      platformFeePercent: platformFee.platformFeePercent,
      platformWalletId: platformFee.platformWalletId,
      orgWalletId: account?.walletId,
    });
  }

  // dealId só usado pra escopo (auth + cross-org guard via pipeline)
  void dealId;

  const ok = Object.values(results).every((r) => r.ok);
  return NextResponse.json({ ok, results });
}
