import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  resolveClickSignCreds,
  isClickSignConfigured,
  ClickSignNotConfiguredError,
  requireClickSignCreds,
} from "../account";

// decryptSecret real exige MASTER_ENCRYPTION_KEY; mockamos pra devolver o token.
vi.mock("@/lib/security/crypto", () => ({
  decryptSecret: vi.fn(() => "decrypted-token"),
}));

const accFind = prisma.clickSignAccount.findUnique as unknown as ReturnType<
  typeof vi.fn
>;

describe("resolveClickSignCreds — multitenant + fallback legado", () => {
  const origShared = process.env.SHARED_ORG_ID;
  const origToken = process.env.CLICKSIGN_API_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHARED_ORG_ID = "shared-org";
    process.env.CLICKSIGN_API_TOKEN = "global-token";
    accFind.mockResolvedValue(null);
  });
  afterEach(() => {
    process.env.SHARED_ORG_ID = origShared;
    process.env.CLICKSIGN_API_TOKEN = origToken;
  });

  it("conta própria conectada → creds da org (source=org)", async () => {
    accFind.mockResolvedValue({
      status: "connected",
      apiTokenEncrypted: "c",
      apiTokenIvBase64: "i",
      apiTokenTagBase64: "t",
      baseUrl: "https://app.clicksign.com/",
    });
    const creds = await resolveClickSignCreds("org-x");
    expect(creds).toEqual({
      token: "decrypted-token",
      baseUrl: "https://app.clicksign.com",
      source: "org",
    });
  });

  it("conta desconectada → cai no fallback (null p/ org comum)", async () => {
    accFind.mockResolvedValue({ status: "disconnected" });
    expect(await resolveClickSignCreds("org-x")).toBeNull();
  });

  it("sem conta + org compartilhada legada → fallback global", async () => {
    const creds = await resolveClickSignCreds("shared-org");
    expect(creds?.source).toBe("legacy_global");
    expect(creds?.token).toBe("global-token");
  });

  it("sem conta + org comum → null (não envia)", async () => {
    expect(await resolveClickSignCreds("org-comum")).toBeNull();
    expect(await isClickSignConfigured("org-comum")).toBe(false);
  });

  it("requireClickSignCreds lança quando não configurado", async () => {
    await expect(requireClickSignCreds("org-comum")).rejects.toBeInstanceOf(
      ClickSignNotConfiguredError
    );
  });

  it("fallback global exige token no env", async () => {
    delete process.env.CLICKSIGN_API_TOKEN;
    expect(await resolveClickSignCreds("shared-org")).toBeNull();
  });
});
