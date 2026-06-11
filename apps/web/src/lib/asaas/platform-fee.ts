import { prisma } from "@/lib/db/prisma";

/**
 * Resolve o markup da plataforma pra uma org/conta (multitenant Fase 1d).
 *
 * Fonte GLOBAL: `PlatformConfig` (singleton, super-admin) — `defaultPlatformFeePercent`
 * + conta-mãe (`asaasParentAccountId` → walletId). OVERRIDE per-org:
 * `OrgFinancialSettings.platformFeePercent` / `platformFeeWalletId`.
 *
 * Semântica do override (o campo é `Float @default(0)` não-nullable, então não
 * dá pra distinguir "0 explícito" de "não setado"): `> 0` na org sobrescreve o
 * global; `0` herda o global. **Backward-compatible:** enquanto o global default
 * for 0 (estado atual), o resultado é idêntico ao legado (`settings ?? 0`).
 *
 * Wallet: override da org → conta-mãe do PlatformConfig → env PLATFORM_WALLET_ID.
 */
export async function resolvePlatformFee(
  orgId: string,
  accountId?: string | null
): Promise<{ platformFeePercent: number; platformWalletId: string | null }> {
  const config = await prisma.platformConfig.findFirst();
  // Settings da conta específica → fallback pras settings org-default (accountId
  // null). Replica a precedência legada dos call-sites de cobrança.
  let settings = accountId
    ? await prisma.orgFinancialSettings.findUnique({ where: { accountId } })
    : null;
  if (!settings) {
    settings = await prisma.orgFinancialSettings.findFirst({
      where: { orgId, accountId: null },
    });
  }

  const globalFee = config ? Number(config.defaultPlatformFeePercent) : 0;
  const orgFee = settings?.platformFeePercent ?? 0;
  const platformFeePercent = orgFee > 0 ? orgFee : globalFee;

  let platformWalletId: string | null = settings?.platformFeeWalletId ?? null;
  if (!platformWalletId && config?.asaasParentAccountId) {
    const parent = await prisma.asaasAccount.findUnique({
      where: { id: config.asaasParentAccountId },
      select: { walletId: true },
    });
    platformWalletId = parent?.walletId ?? null;
  }
  if (!platformWalletId) {
    platformWalletId = process.env.PLATFORM_WALLET_ID ?? null;
  }

  return { platformFeePercent, platformWalletId };
}
