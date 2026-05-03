import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateRawToken,
  hashToken,
  isValidScope,
  createApiToken,
  verifyBearerToken,
  revokeApiToken,
} from "../api-token";
import { prisma } from "@/lib/db/prisma";

const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api-token utilities", () => {
  describe("generateRawToken", () => {
    it("starts with cmt_ prefix", () => {
      const t = generateRawToken();
      expect(t.startsWith("cmt_")).toBe(true);
    });

    it("produces base64url payload of 32 bytes (~43 chars)", () => {
      const t = generateRawToken();
      const payload = t.slice(4);
      expect(payload.length).toBeGreaterThanOrEqual(40);
      expect(payload.length).toBeLessThanOrEqual(50);
      expect(/^[A-Za-z0-9_-]+$/.test(payload)).toBe(true);
    });

    it("yields unique tokens across calls", () => {
      const a = generateRawToken();
      const b = generateRawToken();
      expect(a).not.toBe(b);
    });
  });

  describe("hashToken", () => {
    it("returns 64-char hex sha256", () => {
      const h = hashToken("cmt_test");
      expect(h.length).toBe(64);
      expect(/^[a-f0-9]{64}$/.test(h)).toBe(true);
    });

    it("is deterministic", () => {
      expect(hashToken("cmt_x")).toBe(hashToken("cmt_x"));
    });

    it("differs for different inputs", () => {
      expect(hashToken("cmt_a")).not.toBe(hashToken("cmt_b"));
    });
  });

  describe("isValidScope", () => {
    it("accepts known scopes", () => {
      expect(isValidScope("deals:rw")).toBe(true);
      expect(isValidScope("metrics:r")).toBe(true);
    });

    it("rejects unknown scopes", () => {
      expect(isValidScope("admin:rw")).toBe(false);
      expect(isValidScope("deals:wr")).toBe(false);
      expect(isValidScope("")).toBe(false);
    });
  });
});

describe("createApiToken", () => {
  it("rejects empty scopes", async () => {
    await expect(
      createApiToken({
        userId: "u1",
        name: "test",
        scopes: [],
      })
    ).rejects.toThrow(/at least one scope/);
  });

  it("creates token and returns rawToken once", async () => {
    mockPrisma.userApiToken.create.mockResolvedValueOnce({
      id: "t1",
      name: "Newton",
      scopes: ["deals:rw"],
      expiresAt: null,
      createdAt: new Date("2026-05-03"),
    } as never);

    const result = await createApiToken({
      userId: "u1",
      name: "Newton",
      scopes: ["deals:rw"],
    });

    expect(result.rawToken).toMatch(/^cmt_/);
    expect(result.token.id).toBe("t1");
    expect(mockPrisma.userApiToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          name: "Newton",
          scopes: ["deals:rw"],
          hashedToken: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      })
    );
  });
});

describe("verifyBearerToken", () => {
  it("returns null for non-prefixed tokens", async () => {
    const result = await verifyBearerToken("not-a-token");
    expect(result).toBeNull();
    expect(mockPrisma.userApiToken.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for unknown hash", async () => {
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce(null as never);
    const result = await verifyBearerToken("cmt_abcdefghij");
    expect(result).toBeNull();
  });

  it("returns null for revoked token", async () => {
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"],
      revokedAt: new Date("2026-04-01"),
      expiresAt: null,
    } as never);
    const result = await verifyBearerToken("cmt_abc");
    expect(result).toBeNull();
  });

  it("returns null for expired token", async () => {
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"],
      revokedAt: null,
      expiresAt: new Date("2020-01-01"),
    } as never);
    const result = await verifyBearerToken("cmt_abc");
    expect(result).toBeNull();
  });

  it("returns userId/tokenId/scopes for valid token", async () => {
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw", "metrics:r"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValueOnce({} as never);

    const result = await verifyBearerToken("cmt_validtoken");
    expect(result).toEqual({
      userId: "u1",
      tokenId: "t1",
      scopes: ["deals:rw", "metrics:r"],
    });
  });
});

describe("revokeApiToken", () => {
  it("returns true when token is revoked", async () => {
    mockPrisma.userApiToken.updateMany.mockResolvedValueOnce({
      count: 1,
    } as never);
    const result = await revokeApiToken("t1", "u1");
    expect(result).toBe(true);
  });

  it("returns false when token not found or already revoked", async () => {
    mockPrisma.userApiToken.updateMany.mockResolvedValueOnce({
      count: 0,
    } as never);
    const result = await revokeApiToken("t1", "u1");
    expect(result).toBe(false);
  });

  it("scopes by both tokenId and userId (prevents cross-user revoke)", async () => {
    mockPrisma.userApiToken.updateMany.mockResolvedValueOnce({
      count: 0,
    } as never);
    await revokeApiToken("t1", "u1");
    expect(mockPrisma.userApiToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1", userId: "u1", revokedAt: null },
      })
    );
  });
});
