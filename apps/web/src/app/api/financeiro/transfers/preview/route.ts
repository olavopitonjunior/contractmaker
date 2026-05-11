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
import { getBalance } from "@/lib/asaas/finance";
import { validatePixKey, detectPixKeyType } from "@/lib/asaas/pix";
import { readElevation } from "@/lib/security/elevation";
import {
  getAccountWithApiKey,
  resolveAsaasAccount,
} from "@/lib/asaas/account";

const bodySchema = z.object({
  accountId: z.string().optional(),
  type: z.enum(["PIX", "TED"]),
  value: z.number().positive(),
  pixAddressKey: z.string().optional(),
  bankAccount: z
    .object({
      bankCode: z.string(),
      ownerName: z.string(),
      cpfCnpj: z.string(),
      agency: z.string(),
      account: z.string(),
      accountDigit: z.string(),
      accountType: z.enum(["CONTA_CORRENTE", "CONTA_POUPANCA"]).optional(),
    })
    .optional(),
});

/**
 * POST /api/financeiro/transfers/preview
 * Valida saldo + validação de chave PIX. Retorna dados para confirmação antes
 * de criar challenge OTP + transferir de fato.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.TRANSFER_INIT,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  // Exige elevation TRANSFER
  const elev = await readElevation();
  if (!elev || elev.userId !== ctx.userId || !elev.scopes.includes("TRANSFER")) {
    return NextResponse.json(
      { error: "ELEVATION_REQUIRED", scope: "TRANSFER" },
      { status: 403 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
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
    requireCapability: "init_transfer",
  });
  if (!resolved || resolved.account.status !== "APPROVED") {
    return NextResponse.json({ error: "Conta Asaas não aprovada" }, { status: 422 });
  }
  const account = resolved.account;
  const { apiKey } = await getAccountWithApiKey(account.id);

  const balance = await getBalance({ apiKey });
  const available =
    balance.totalBalance ?? balance.availableBalance ?? balance.balance ?? 0;

  if (parsed.data.value > available) {
    return NextResponse.json(
      {
        error: "INSUFFICIENT_BALANCE",
        available,
        requested: parsed.data.value,
      },
      { status: 422 }
    );
  }

  // Settings — caps (per-account; fallback p/ legacy org-level)
  const settings =
    (await prisma.orgFinancialSettings.findUnique({
      where: { accountId: account.id },
    })) ??
    (await prisma.orgFinancialSettings.findFirst({
      where: { orgId: ctx.orgId, accountId: null },
    }));
  const dualCap = settings?.dualApprovalCapCents ?? 5_000_000;
  const hardCap = settings?.hardCapCents ?? 10_000_000;

  const valueCents = Math.round(parsed.data.value * 100);
  if (valueCents > hardCap) {
    return NextResponse.json(
      {
        error: "HARD_CAP_EXCEEDED",
        hardCapBrl: hardCap / 100,
      },
      { status: 422 }
    );
  }

  const requiresDualApproval = valueCents > dualCap;

  // Validação PIX
  let pixValidation = null;
  if (parsed.data.type === "PIX") {
    if (!parsed.data.pixAddressKey) {
      return NextResponse.json(
        { error: "pixAddressKey obrigatório para transferência PIX" },
        { status: 400 }
      );
    }
    const keyType = detectPixKeyType(parsed.data.pixAddressKey);
    if (!keyType) {
      return NextResponse.json(
        { error: "Chave PIX inválida" },
        { status: 400 }
      );
    }
    pixValidation = await validatePixKey({
      key: parsed.data.pixAddressKey,
      apiKey,
    });
  }

  // Taxa estimada: PIX grátis, TED R$ 1,50 (estimate — Asaas cobra real depois)
  const estimatedFee = parsed.data.type === "PIX" ? 0 : 1.5;

  return NextResponse.json({
    ok: true,
    accountId: account.id,
    availableBalance: available,
    requestedValue: parsed.data.value,
    estimatedFee,
    netAfterTransfer: available - parsed.data.value - estimatedFee,
    requiresDualApproval,
    dualApprovalCapBrl: dualCap / 100,
    pixValidation,
  });
}
