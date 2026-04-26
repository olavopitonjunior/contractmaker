import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/crypto";
import { getBalance } from "@/lib/asaas/finance";
import { getMyAccountStatus } from "@/lib/asaas/kyc";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/asaas-health
 *
 * Health check em tempo real da integração Asaas:
 *   - Status da subconta (commercial/bank/docs/general)
 *   - Saldo atualizado
 *   - Último webhook recebido (timestamp + delta)
 *   - Quantidade de webhooks com erro nos últimos 7 dias
 *
 * Não cacheado pesado — chama Asaas a cada request. Expectativa: usado
 * pelo dashboard `/settings/operacoes` com refresh manual ou interval
 * de 60s. Não chamar em loop curto (Asaas tem rate limit).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 401 });
  }

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: org.id },
  });
  if (!account) {
    return NextResponse.json(
      { ok: false, reason: "no_asaas_account" },
      { status: 200 }
    );
  }

  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  const [statusResult, balanceResult, lastWebhook, sevenDayErrors] =
    await Promise.allSettled([
      getMyAccountStatus({ apiKey }),
      getBalance({ apiKey }),
      prisma.asaasWebhookEvent.findFirst({
        where: { orgId: org.id },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true, event: true },
      }),
      prisma.asaasWebhookEvent.count({
        where: {
          orgId: org.id,
          receivedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
          processingError: { not: null },
        },
      }),
    ]);

  const accountStatus =
    statusResult.status === "fulfilled" ? statusResult.value : null;
  const accountStatusError =
    statusResult.status === "rejected"
      ? statusResult.reason instanceof Error
        ? statusResult.reason.message
        : String(statusResult.reason)
      : null;

  const balance =
    balanceResult.status === "fulfilled" ? balanceResult.value : null;
  const balanceError =
    balanceResult.status === "rejected"
      ? balanceResult.reason instanceof Error
        ? balanceResult.reason.message
        : String(balanceResult.reason)
      : null;

  const lastWebhookData =
    lastWebhook.status === "fulfilled" ? lastWebhook.value : null;
  const lastWebhookAgeMin = lastWebhookData?.receivedAt
    ? Math.floor(
        (Date.now() - lastWebhookData.receivedAt.getTime()) / 60000
      )
    : null;

  const errors7d = sevenDayErrors.status === "fulfilled" ? sevenDayErrors.value : 0;

  // Health summary
  const ok =
    accountStatus !== null &&
    accountStatus.general === "APPROVED" &&
    errors7d === 0;

  return NextResponse.json({
    ok,
    asaasEnv: process.env.ASAAS_ENV ?? "unknown",
    accountStatus: accountStatus
      ? {
          general: accountStatus.general,
          commercialInfo: accountStatus.commercialInfo,
          bankAccountInfo: accountStatus.bankAccountInfo,
          documentation: accountStatus.documentation,
        }
      : null,
    accountStatusError,
    balance: balance
      ? {
          total: balance.totalBalance ?? balance.balance ?? null,
          available: balance.availableBalance ?? null,
          blocked: balance.blockedBalance ?? null,
          pending: balance.pendingBalance ?? null,
        }
      : null,
    balanceError,
    lastWebhook: lastWebhookData
      ? {
          receivedAt: lastWebhookData.receivedAt,
          event: lastWebhookData.event,
          ageMinutes: lastWebhookAgeMin,
        }
      : null,
    errors7d,
  });
}
