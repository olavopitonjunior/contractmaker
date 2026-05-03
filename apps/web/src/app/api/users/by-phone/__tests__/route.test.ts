import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(query: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/users/by-phone${query}`, {
    headers,
  });
}

describe("GET /api/users/by-phone", () => {
  it("returns 401 when no auth", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when phone param missing", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Bad Request");
  });

  it("returns 400 when phone is malformed", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await GET(makeRequest("?phone=11987654321"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when phone has wrong country prefix", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await GET(makeRequest("?phone=%2B0123"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when user not found", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce(null as never);
    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when user is soft-deleted (LGPD)", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Test",
      deletedAt: new Date(),
      orgMemberships: [{ orgId: "o1", role: "member" }],
    } as never);
    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when user has no org memberships", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Test",
      deletedAt: null,
      orgMemberships: [],
    } as never);
    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(404);
  });

  it("returns userId/orgId/role/name for valid lookup via session auth", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Olavo",
      deletedAt: null,
      orgMemberships: [{ orgId: "org-1", role: "owner" }],
    } as never);

    const res = await GET(makeRequest("?phone=%2B5511987654321"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      userId: "u1",
      orgId: "org-1",
      role: "owner",
      name: "Olavo",
    });
    // Privacy: email NOT in response
    expect("email" in body).toBe(false);
  });

  it("returns 403 when bearer auth lacks metrics:r scope", async () => {
    mockAuth.mockResolvedValueOnce(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"], // sem metrics:r
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValueOnce({} as never);

    const res = await GET(
      makeRequest("?phone=%2B5511987654321", {
        Authorization: "Bearer cmt_xyz",
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toMatch(/metrics:r/);
  });

  it("succeeds with bearer auth when metrics:r scope present", async () => {
    mockAuth.mockResolvedValueOnce(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      scopes: ["metrics:r"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValueOnce({} as never);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      name: "Olavo",
      deletedAt: null,
      orgMemberships: [{ orgId: "org-1", role: "owner" }],
    } as never);

    const res = await GET(
      makeRequest("?phone=%2B5511987654321", {
        Authorization: "Bearer cmt_xyz",
      })
    );
    expect(res.status).toBe(200);
  });
});
