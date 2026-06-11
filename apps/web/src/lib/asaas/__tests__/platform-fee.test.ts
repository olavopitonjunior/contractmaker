import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolvePlatformFee } from "../platform-fee";

const platformConfig = prisma.platformConfig.findFirst as unknown as ReturnType<typeof vi.fn>;
const orgSettings = prisma.orgFinancialSettings.findFirst as unknown as ReturnType<typeof vi.fn>;
const asaasAccount = prisma.asaasAccount.findUnique as unknown as ReturnType<typeof vi.fn>;

describe("resolvePlatformFee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformConfig.mockResolvedValue(null);
    orgSettings.mockResolvedValue(null);
    asaasAccount.mockResolvedValue(null);
    delete process.env.PLATFORM_WALLET_ID;
  });

  it("sem config nem settings → 0 / null (backward-compat)", async () => {
    const r = await resolvePlatformFee("org1");
    expect(r).toEqual({ platformFeePercent: 0, platformWalletId: null });
  });

  it("usa o default global do PlatformConfig quando a org não tem override", async () => {
    platformConfig.mockResolvedValue({ defaultPlatformFeePercent: 0.5, asaasParentAccountId: "acc_parent" });
    orgSettings.mockResolvedValue({ platformFeePercent: 0, platformFeeWalletId: null });
    asaasAccount.mockResolvedValue({ walletId: "wallet_parent" });
    const r = await resolvePlatformFee("org1");
    expect(r.platformFeePercent).toBe(0.5);
    expect(r.platformWalletId).toBe("wallet_parent");
  });

  it("override per-org (> 0) sobrescreve o global", async () => {
    platformConfig.mockResolvedValue({ defaultPlatformFeePercent: 0.5, asaasParentAccountId: "acc_parent" });
    orgSettings.mockResolvedValue({ platformFeePercent: 1.2, platformFeeWalletId: "wallet_org" });
    const r = await resolvePlatformFee("org1");
    expect(r.platformFeePercent).toBe(1.2);
    expect(r.platformWalletId).toBe("wallet_org"); // override da org tem prioridade
  });

  it("converte Decimal do PlatformConfig", async () => {
    // Prisma Decimal vira objeto; Number() resolve. Simula com string numérica.
    platformConfig.mockResolvedValue({ defaultPlatformFeePercent: "0.75", asaasParentAccountId: null });
    const r = await resolvePlatformFee("org1");
    expect(r.platformFeePercent).toBe(0.75);
  });

  it("cai no env PLATFORM_WALLET_ID quando não há override nem conta-mãe", async () => {
    process.env.PLATFORM_WALLET_ID = "wallet_env";
    platformConfig.mockResolvedValue({ defaultPlatformFeePercent: 0.5, asaasParentAccountId: null });
    const r = await resolvePlatformFee("org1");
    expect(r.platformWalletId).toBe("wallet_env");
  });
});
