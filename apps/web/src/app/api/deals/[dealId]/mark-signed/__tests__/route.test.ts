import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
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

function makeReq() {
  return new NextRequest("http://localhost/api/deals/d1/mark-signed", {
    method: "POST",
  });
}

const baseDeal = {
  id: "d1",
  stageId: "s1",
  pipelineId: "p1",
  stage: { id: "s1", name: "Assinatura" },
  pipeline: {
    orgId: "org-1",
    stages: [
      { id: "s0", name: "Lead", position: 0 },
      { id: "s1", name: "Assinatura", position: 1 },
      { id: "s2", name: "Concluído", position: 2 },
    ],
  },
  form: { orgId: "org-1" },
};

describe("POST /api/deals/[dealId]/mark-signed", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("404 deal inexistente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("403 cross-org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      ...baseDeal,
      form: { orgId: "other-org" },
      pipeline: { ...baseDeal.pipeline, orgId: "other-org" },
    } as never);
    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("400 quando deal não está em stage Assinatura", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      ...baseDeal,
      stage: { id: "s0", name: "Lead" },
    } as never);
    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(400);
  });

  it("200 happy path: move pra Concluído", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.deal.update.mockResolvedValue({} as never);

    const res = await POST(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("concluido");
    expect(json.stageName).toBe("Concluído");
    expect(mockPrisma.deal.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { stageId: "s2" },
    });
  });
});
