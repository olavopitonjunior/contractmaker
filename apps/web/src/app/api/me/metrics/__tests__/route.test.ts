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

function makeReq(query = "", headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/me/metrics${query}`, { headers });
}

describe("GET /api/me/metrics", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("403 com bearer sem metrics:r", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      scopes: ["deals:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);

    const res = await GET(
      makeReq("", { Authorization: "Bearer cmt_x" })
    );
    expect(res.status).toBe(403);
  });

  it("400 quando since não é ISO válido", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await GET(makeReq("?since=not-a-date"));
    expect(res.status).toBe(400);
  });

  it("agrega counts por entidade e por status", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.groupBy.mockResolvedValue([
      { stageId: "stage-1", _count: { _all: 3 } },
      { stageId: "stage-2", _count: { _all: 5 } },
    ] as never);
    mockPrisma.contract.groupBy.mockResolvedValue([
      { status: "rascunho", _count: { _all: 2 } },
      { status: "aprovado", _count: { _all: 1 } },
    ] as never);
    mockPrisma.commissionCharge.groupBy.mockResolvedValue([
      { status: "PENDING", _count: { _all: 4 } },
    ] as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deals.total).toBe(8);
    expect(body.deals.byStage["stage-1"]).toBe(3);
    expect(body.contracts.total).toBe(3);
    expect(body.contracts.byStatus.aprovado).toBe(1);
    expect(body.charges.total).toBe(4);
    expect(body.since).toBeDefined();
    expect(body.until).toBeDefined();
  });

  it("totals zerados quando não há dados", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.groupBy.mockResolvedValue([] as never);
    mockPrisma.contract.groupBy.mockResolvedValue([] as never);
    mockPrisma.commissionCharge.groupBy.mockResolvedValue([] as never);

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.deals.total).toBe(0);
    expect(body.contracts.total).toBe(0);
    expect(body.charges.total).toBe(0);
  });
});
