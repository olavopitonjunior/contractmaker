import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindUnique,
  mockUpdate,
  mockGetOwnerOAuthClient,
  mockIsOwnerOAuthConfigured,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockGetOwnerOAuthClient: vi.fn(),
  mockIsOwnerOAuthConfigured: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    orgGoogleAccount: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("../client", () => ({
  envTrim: (name: string) =>
    ({
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
    })[name],
  getOwnerOAuthClient: mockGetOwnerOAuthClient,
  getDriveFolderId: () => "global-folder",
  isOwnerOAuthConfigured: mockIsOwnerOAuthConfigured,
}));

import {
  resolveOwnerAuth,
  withOwnerAuth,
  resolveDriveParent,
  __resetOrgOAuthCacheForTests,
} from "../org-oauth";
import { encryptSecret } from "@/lib/security/crypto";

function encryptedAccount(overrides: Record<string, unknown> = {}) {
  const enc = encryptSecret("refresh-token-da-org");
  return {
    orgId: "org-1",
    email: "drive@imobiliaria.com.br",
    refreshTokenEncrypted: enc.ciphertext,
    refreshTokenIvBase64: enc.iv,
    refreshTokenTagBase64: enc.tag,
    status: "connected",
    driveFolderId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetOrgOAuthCacheForTests();
  process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  mockGetOwnerOAuthClient.mockReturnValue({ __global: true });
  mockIsOwnerOAuthConfigured.mockReturnValue(true);
  mockUpdate.mockResolvedValue({});
});

describe("resolveOwnerAuth", () => {
  it("sem orgId → global", async () => {
    const r = await resolveOwnerAuth(undefined);
    expect(r.source).toBe("global");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("org sem conta conectada → fallback global", async () => {
    mockFindUnique.mockResolvedValue(null);
    const r = await resolveOwnerAuth("org-1");
    expect(r.source).toBe("global");
  });

  it("org com status revoked → fallback global", async () => {
    mockFindUnique.mockResolvedValue(encryptedAccount({ status: "revoked" }));
    const r = await resolveOwnerAuth("org-1");
    expect(r.source).toBe("global");
  });

  it("org conectada → client da org (round-trip do refresh token criptografado)", async () => {
    mockFindUnique.mockResolvedValue(encryptedAccount());
    const r = await resolveOwnerAuth("org-1");
    expect(r.source).toBe("org");
    expect(r.accountEmail).toBe("drive@imobiliaria.com.br");
    // OAuth2Client com refresh token decriptado
    const creds = (r.auth as { credentials?: { refresh_token?: string } }).credentials;
    expect(creds?.refresh_token).toBe("refresh-token-da-org");
  });
});

describe("withOwnerAuth", () => {
  it("invalid_grant na credencial da org → marca revoked e re-tenta com global", async () => {
    mockFindUnique.mockResolvedValue(encryptedAccount());
    const calls: string[] = [];
    const result = await withOwnerAuth("org-1", async (resolved) => {
      calls.push(resolved.source);
      if (resolved.source === "org") {
        throw new Error("invalid_grant: Token has been expired or revoked.");
      }
      return "ok-no-global";
    });
    expect(result).toBe("ok-no-global");
    expect(calls).toEqual(["org", "global"]);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-1" },
        data: expect.objectContaining({ status: "revoked" }),
      })
    );
  });

  it("erro comum (não invalid_grant) propaga sem retry", async () => {
    mockFindUnique.mockResolvedValue(encryptedAccount());
    await expect(
      withOwnerAuth("org-1", async () => {
        throw new Error("quota exceeded");
      })
    ).rejects.toThrow("quota exceeded");
  });
});

describe("resolveDriveParent", () => {
  it("source global → pasta do env", async () => {
    const parent = await resolveDriveParent({
      auth: {} as never,
      source: "global",
    });
    expect(parent).toBe("global-folder");
  });

  it("source org com pasta persistida → reusa sem criar", async () => {
    mockFindUnique.mockResolvedValue({ driveFolderId: "pasta-org" });
    const parent = await resolveDriveParent({
      auth: {} as never,
      source: "org",
      orgId: "org-1",
    });
    expect(parent).toBe("pasta-org");
  });
});
