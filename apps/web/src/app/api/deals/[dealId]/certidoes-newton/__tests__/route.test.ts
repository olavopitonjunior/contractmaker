import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

vi.mock("@/lib/certidoes/planner", () => ({
  planCertidoesForDeal: vi.fn(() => ({
    jobs: [{ endpoint: "x", label: "Test", costCents: 100, targetKind: "vendedor", targetIndex: 0 }],
    skipped: [],
  })),
  diligentedPersonToInput: vi.fn((d) => d),
}));
vi.mock("@/lib/certidoes/executor", () => ({
  getMonthlySpend: vi.fn(async () => ({
    spentCents: 0,
    budgetCents: 100000,
    exceeded: false,
  })),
  runBatch: vi.fn(),
}));
vi.mock("@/lib/certidoes/govbr-auth", () => ({
  checkGovBrAuth: vi.fn(async () => ({ active: true })),
}));
vi.mock("@/lib/certidoes/newton-runner", () => ({
  runCertidoesBatchInline: vi.fn(async () => ({
    status: 202,
    body: { batchId: "b1", jobCount: 1 },
  })),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

const VALID_BATCH_ID = "11111111-1111-4111-8111-111111111111";

function makeReq(body: unknown = { batchId: VALID_BATCH_ID }) {
  return new NextRequest("http://localhost/api/deals/d1/certidoes-newton", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const baseDeal = {
  id: "d1",
  form: { orgId: "org-1", dataJson: { vendedores: [], compradores: [] } },
  pipeline: { orgId: "org-1" },
};

describe("POST /api/deals/[dealId]/certidoes-newton (HITL)", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("400 batchId invalido", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await POST(makeReq({ batchId: "not-a-uuid" }), {
      params: { dealId: "d1" },
    });
    expect(res.status).toBe(400);
  });

  it("404 deal inexistente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("409 batch ativo recente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.diligentedPerson.findMany.mockResolvedValue([] as never);
    mockPrisma.certidaoJob.findFirst.mockResolvedValue({
      batchId: "old-batch",
    } as never);
    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(409);
  });

  it("via session executa direto (200/202)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.diligentedPerson.findMany.mockResolvedValue([] as never);
    mockPrisma.certidaoJob.findFirst.mockResolvedValue(null as never);

    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect([200, 202]).toContain(res.status);
  });
});
