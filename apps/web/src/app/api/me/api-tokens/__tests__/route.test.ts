import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body?: unknown) {
  return new NextRequest("http://localhost/api/me/api-tokens", {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : {},
  });
}

describe("GET /api/me/api-tokens", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns user's tokens", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.userApiToken.findMany.mockResolvedValueOnce([
      {
        id: "t1",
        name: "Newton",
        scopes: ["deals:rw"],
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date("2026-05-01"),
      },
    ] as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0].name).toBe("Newton");
    // hashedToken NOT in response
    expect("hashedToken" in body.tokens[0]).toBe(false);
  });
});

describe("POST /api/me/api-tokens", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ name: "x", scopes: ["deals:rw"] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when scopes empty", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await POST(makeRequest({ name: "x", scopes: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when scope is invalid", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await POST(
      makeRequest({ name: "x", scopes: ["admin:rw"] })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when name missing", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    const res = await POST(makeRequest({ scopes: ["deals:rw"] }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when user has no org membership", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.orgMembership.findFirst.mockResolvedValueOnce(null as never);
    const res = await POST(
      makeRequest({ name: "Newton", scopes: ["deals:rw"] })
    );
    expect(res.status).toBe(403);
  });

  it("creates token and returns rawToken once", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.orgMembership.findFirst.mockResolvedValueOnce({
      orgId: "org-1",
    } as never);
    mockPrisma.userApiToken.create.mockResolvedValueOnce({
      id: "t1",
      name: "Newton",
      scopes: ["deals:rw"],
      expiresAt: null,
      createdAt: new Date(),
    } as never);

    const res = await POST(
      makeRequest({ name: "Newton", scopes: ["deals:rw"] })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.rawToken).toMatch(/^cmt_/);
    expect(body.token.id).toBe("t1");
    expect(body.warning).toMatch(/Salve o rawToken agora/);
  });

  it("creates audit log entry on success", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession() as never);
    mockPrisma.orgMembership.findFirst.mockResolvedValueOnce({
      orgId: "org-1",
    } as never);
    mockPrisma.userApiToken.create.mockResolvedValueOnce({
      id: "t1",
      name: "Newton",
      scopes: ["deals:rw"],
      expiresAt: null,
      createdAt: new Date(),
    } as never);

    await POST(makeRequest({ name: "Newton", scopes: ["deals:rw"] }));
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "API_TOKEN_CREATED",
          result: "SUCCESS",
          orgId: "org-1",
          userId: "user-1",
        }),
      })
    );
  });
});
