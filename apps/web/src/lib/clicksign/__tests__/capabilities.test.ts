import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { detectAndCacheCapabilities } from "../capabilities";

const upsert = prisma.orgSignatureSettings.upsert as unknown as ReturnType<typeof vi.fn>;
const findUnique = prisma.orgSignatureSettings.findUnique as unknown as ReturnType<typeof vi.fn>;

const CREDS = { token: "t", baseUrl: "https://app.clicksign.com" };
const NOW = new Date("2026-07-15T10:00:00Z");
const base = (over = {}) => ({
  resolveCreds: async () => CREDS,
  now: () => NOW,
  ...over,
});

describe("detectAndCacheCapabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ acceptanceEnabled: false });
    upsert.mockResolvedValue({});
  });

  it("sem conta ClickSign → not_configured, sem tocar o banco", async () => {
    const r = await detectAndCacheCapabilities("org1", base({ resolveCreds: async () => null }));
    expect(r).toEqual({ error: "not_configured" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("probe available → cacheia whatsappSignatureAvailable=true", async () => {
    const r = await detectAndCacheCapabilities(
      "org1",
      base({ probe: async () => "available" as const })
    );
    expect(r).toMatchObject({ whatsappSignatureAvailable: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          whatsappSignatureAvailable: true,
          capabilitiesCheckedAt: NOW,
        }),
      })
    );
  });

  it("probe unavailable → cacheia false", async () => {
    await detectAndCacheCapabilities("org1", base({ probe: async () => "unavailable" as const }));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ whatsappSignatureAvailable: false }),
      })
    );
  });

  it("probe inconclusive → NÃO sobrescreve whatsappSignatureAvailable (só carimba a data)", async () => {
    const r = await detectAndCacheCapabilities(
      "org1",
      base({ probe: async () => "inconclusive" as const })
    );
    expect(r).toMatchObject({ whatsappSignatureAvailable: null });
    const call = upsert.mock.calls[0][0];
    expect("whatsappSignatureAvailable" in call.update).toBe(false);
    expect(call.update.capabilitiesCheckedAt).toEqual(NOW);
  });

  it("acceptanceWhatsappAvailable deriva do acceptanceEnabled da org", async () => {
    findUnique.mockResolvedValue({ acceptanceEnabled: true });
    const r = await detectAndCacheCapabilities(
      "org1",
      base({ probe: async () => "available" as const })
    );
    expect(r).toMatchObject({ acceptanceWhatsappAvailable: true });
  });
});
