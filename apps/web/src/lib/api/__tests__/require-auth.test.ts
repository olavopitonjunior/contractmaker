import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "../require-auth";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

function makeReq(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/x", { headers });
}

describe("requireApiAuth", () => {
  it("retorna 401 quando não há auth", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await requireApiAuth(makeReq());
    expect(isAuthFailure(r)).toBe(true);
    if (isAuthFailure(r)) expect(r.status).toBe(401);
  });

  it("retorna 403 com bearer sem escopo exigido", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      scopes: ["metrics:r"], // sem deals:rw
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);

    const r = await requireApiAuth(
      makeReq({ Authorization: "Bearer cmt_x" }),
      { scope: "deals:rw" }
    );
    expect(isAuthFailure(r)).toBe(true);
    if (isAuthFailure(r)) {
      expect(r.status).toBe(403);
      expect(r.reason).toMatch(/deals:rw/);
    }
  });

  it("session passa em qualquer escopo (UI tem poder total)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const r = await requireApiAuth(makeReq(), { scope: "deals:rw" });
    expect(isAuthFailure(r)).toBe(false);
  });

  it("rejeita header X-Newton-Actor sob session (UI não deveria mandar)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const r = await requireApiAuth(
      makeReq({ "x-newton-actor": "u1" })
    );
    expect(isAuthFailure(r)).toBe(true);
    if (isAuthFailure(r)) {
      expect(r.status).toBe(403);
      expect(r.reason).toBe("header_without_bearer");
    }
  });

  it("rejeita spoofing: bearer + X-Newton-Actor diferente do token.userId", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);

    const r = await requireApiAuth(
      makeReq({
        Authorization: "Bearer cmt_x",
        "x-newton-actor": "u2", // diferente do token.userId
      })
    );
    expect(isAuthFailure(r)).toBe(true);
    if (isAuthFailure(r)) {
      expect(r.status).toBe(403);
      expect(r.reason).toBe("header_user_mismatch");
    }
  });

  it("audita NEWTON_ACTOR_HEADER_REJECTED em spoofing bearer", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);

    await requireApiAuth(
      makeReq({
        Authorization: "Bearer cmt_x",
        "x-newton-actor": "u2",
      })
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "NEWTON_ACTOR_HEADER_REJECTED",
          result: "DENIED",
        }),
      })
    );
  });

  it("retorna 403 quando user não tem org (default requireOrg=true)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockGetUserOrg.mockResolvedValue(null);
    const r = await requireApiAuth(makeReq());
    expect(isAuthFailure(r)).toBe(true);
    if (isAuthFailure(r)) {
      expect(r.status).toBe(403);
      expect(r.reason).toMatch(/no active org/);
    }
  });

  it("permite passar sem org quando requireOrg=false", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockGetUserOrg.mockResolvedValue(null);
    const r = await requireApiAuth(makeReq(), { requireOrg: false });
    expect(isAuthFailure(r)).toBe(false);
    if (!isAuthFailure(r)) expect(r.org.id).toBe("");
  });

  it("happy path session: ident + actor + org populados, sem via", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const r = await requireApiAuth(makeReq());
    expect(isAuthFailure(r)).toBe(false);
    if (!isAuthFailure(r)) {
      expect(r.ident.via).toBe("session");
      expect(r.ident.userId).toBe("user-1");
      expect(r.actor.via).toBeUndefined();
      expect(r.actor.effectiveUserId).toBe("user-1");
      expect(r.org.id).toBe("org-1");
    }
  });

  it("happy path bearer: actor.via=newton para audit", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);
    mockGetUserOrg.mockResolvedValue({ id: "org-bearer" } as never);

    const r = await requireApiAuth(
      makeReq({ Authorization: "Bearer cmt_x" }),
      { scope: "deals:rw" }
    );
    expect(isAuthFailure(r)).toBe(false);
    if (!isAuthFailure(r)) {
      expect(r.ident.via).toBe("bearer");
      expect(r.actor.via).toBe("newton");
      expect(r.actor.effectiveUserId).toBe("u1");
      expect(r.org.id).toBe("org-bearer");
    }
  });
});

describe("authFailureResponse", () => {
  it("retorna NextResponse com status correto", async () => {
    const res = authFailureResponse({
      error: "Forbidden",
      reason: "missing scope deals:rw",
      status: 403,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(body.reason).toBe("missing scope deals:rw");
  });
});
