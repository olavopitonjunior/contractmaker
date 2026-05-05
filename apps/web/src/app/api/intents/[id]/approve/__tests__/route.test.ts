import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

function makeReq() {
  return new NextRequest("http://localhost/api/intents/i-1/approve", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

describe("POST /api/intents/[id]/approve", () => {
  it("rejeita Bearer com 403 (HITL exige session)", async () => {
    // Bearer reach com auth-or-bearer requer mock de userApiToken
    const req = new NextRequest("http://localhost/api/intents/i-1/approve", {
      method: "POST",
      headers: { authorization: "Bearer cmt_x" },
    });
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "tk-1",
      userId: "u-1",
      scopes: [],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockReturnValue({
      catch: vi.fn(),
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: "u@x.com",
      name: "U",
    } as never);
    mockPrisma.orgMembership.findFirst.mockResolvedValue({
      orgId: "org-1",
    } as never);

    const res = await POST(req, { params: { id: "i-1" } });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.reason).toMatch(/session/);
  });

  it("rejeita 404 quando intent não existe", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.actionIntent.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(404);
  });

  it("rejeita 409 quando intent já não está pending", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.actionIntent.findUnique.mockResolvedValueOnce({
      id: "i-1",
      orgId: "org-1",
      requestedBy: "u-1",
      action: "CONTRACT_APPROVE",
      status: "executed",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(409);
  });

  it("rejeita 410 quando expirada", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.actionIntent.findUnique.mockResolvedValueOnce({
      id: "i-1",
      orgId: "org-1",
      requestedBy: "u-1",
      action: "CONTRACT_APPROVE",
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000),
    } as never);
    mockPrisma.actionIntent.update.mockResolvedValue({} as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(410);
  });
});
