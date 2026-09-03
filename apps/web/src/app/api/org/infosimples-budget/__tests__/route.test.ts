import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  // default: usuário tem org
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/org/infosimples-budget", { headers });
}

describe("GET /api/org/infosimples-budget", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("403 sem escopo metrics:r (bearer)", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);

    const res = await GET(makeReq({ Authorization: "Bearer cmt_x" }));
    expect(res.status).toBe(403);
  });

  it("403 quando usuário não tem org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockGetUserOrg.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it("calcula spent e remaining a partir de costCents", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.certidaoJob.findMany.mockResolvedValue([
      { costCents: 1500, endpoint: "iptu" },
      { costCents: 800, endpoint: "matricula" },
      { costCents: 1200, endpoint: "iptu" },
    ] as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spentCents).toBe(3500);
    expect(body.spentByEndpoint.iptu).toBe(2700);
    expect(body.spentByEndpoint.matricula).toBe(800);
    // Default ÚNICO de lib/certidoes/budget.ts (R$ 200 — o que o executor sempre
    // bloqueou). Esta rota dizia R$ 50.000 enquanto o disparo parava em R$ 200.
    expect(body.budgetCents).toBe(20000);
    expect(body.remainingCents).toBe(20000 - 3500);
    expect(body.ok).toBe(true);
    expect(body.warningPct).toBe(0.8);
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("ok=false quando spent excede budget", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    process.env.INFOSIMPLES_MONTHLY_BUDGET_CENTS = "1000";
    mockPrisma.certidaoJob.findMany.mockResolvedValue([
      { costCents: 1500, endpoint: "iptu" },
    ] as never);

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.pct).toBeGreaterThan(1);
    delete process.env.INFOSIMPLES_MONTHLY_BUDGET_CENTS;
  });

  it("zerado quando não há jobs no mês", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.certidaoJob.findMany.mockResolvedValue([] as never);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.spentCents).toBe(0);
    expect(body.spentByEndpoint).toEqual({});
    expect(body.pct).toBe(0);
  });
});
