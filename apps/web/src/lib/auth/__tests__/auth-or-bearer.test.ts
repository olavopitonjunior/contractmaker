import { describe, it, expect, vi, beforeEach } from "vitest";
import { authOrBearer, hasScope } from "../auth-or-bearer";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeReq(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", { headers });
}

describe("authOrBearer", () => {
  it("returns null when neither bearer nor session present", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await authOrBearer(makeReq());
    expect(result).toBeNull();
  });

  it("returns session result when only session is present", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const result = await authOrBearer(makeReq());
    expect(result).toEqual({
      via: "session",
      userId: "user-1",
      email: "test@example.com",
    });
  });

  it("returns bearer result when valid Bearer header is present", async () => {
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValueOnce({} as never);

    const result = await authOrBearer(
      makeReq({ Authorization: "Bearer cmt_validtoken" })
    );

    expect(result).toEqual({
      via: "bearer",
      userId: "u1",
      tokenId: "t1",
      scopes: ["deals:rw"],
    });
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("rejects invalid Bearer without falling back to session", async () => {
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce(null as never);
    const result = await authOrBearer(
      makeReq({ Authorization: "Bearer cmt_invalid" })
    );
    expect(result).toBeNull();
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("ignores empty Bearer header (falls back to session)", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const result = await authOrBearer(makeReq({ Authorization: "Bearer " }));
    expect(result?.via).toBe("session");
  });

  it("handles lowercase 'bearer' prefix", async () => {
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      scopes: [],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValueOnce({} as never);
    const result = await authOrBearer(
      makeReq({ Authorization: "bearer cmt_x" })
    );
    expect(result?.via).toBe("bearer");
  });
});

describe("hasScope", () => {
  it("session auth always has any scope (UI fully privileged)", () => {
    const ident = {
      via: "session" as const,
      userId: "u1",
      email: "x@y.com",
    };
    expect(hasScope(ident, "deals:rw")).toBe(true);
    expect(hasScope(ident, "anything:rw")).toBe(true);
  });

  it("bearer auth has only declared scopes", () => {
    const ident = {
      via: "bearer" as const,
      userId: "u1",
      tokenId: "t1",
      scopes: ["deals:rw", "metrics:r"],
    };
    expect(hasScope(ident, "deals:rw")).toBe(true);
    expect(hasScope(ident, "metrics:r")).toBe(true);
    expect(hasScope(ident, "charges:rw")).toBe(false);
  });

  it("rw implies r: deals:rw token satisfies deals:r", () => {
    const ident = {
      via: "bearer" as const,
      userId: "u1",
      tokenId: "t1",
      scopes: ["deals:rw"],
    };
    expect(hasScope(ident, "deals:r")).toBe(true);
    expect(hasScope(ident, "deals:rw")).toBe(true);
  });

  it("does not grant unrelated read scope", () => {
    const ident = {
      via: "bearer" as const,
      userId: "u1",
      tokenId: "t1",
      scopes: ["metrics:r"],
    };
    // metrics:r não satisfaz deals:r (recurso diferente, e não há deals:rw)
    expect(hasScope(ident, "deals:r")).toBe(false);
  });
});
