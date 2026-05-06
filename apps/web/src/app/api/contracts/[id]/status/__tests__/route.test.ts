import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "../route";
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

function makeReq(body: unknown = { status: "review" }) {
  return new NextRequest("http://localhost/api/contracts/c1/status", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const baseContract = {
  id: "c1",
  status: "rascunho",
  deal: {
    form: { orgId: "org-1" },
    pipeline: { orgId: "org-1" },
  },
};

describe("PATCH /api/contracts/[id]/status", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeReq(), { params: { id: "c1" } });
    expect(res.status).toBe(401);
  });

  it("400 status inválido", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await PATCH(makeReq({ status: "aprovado" }), { params: { id: "c1" } });
    expect(res.status).toBe(400);
  });

  it("404 contrato inexistente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue(null as never);
    const res = await PATCH(makeReq(), { params: { id: "c1" } });
    expect(res.status).toBe(404);
  });

  it("403 cross-org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue({
      ...baseContract,
      deal: { form: { orgId: "other-org" }, pipeline: { orgId: "other-org" } },
    } as never);
    const res = await PATCH(makeReq(), { params: { id: "c1" } });
    expect(res.status).toBe(403);
  });

  it("409 contrato aprovado bloqueia transição", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue({
      ...baseContract,
      status: "aprovado",
    } as never);
    const res = await PATCH(makeReq(), { params: { id: "c1" } });
    expect(res.status).toBe(409);
  });

  it("200 transição rascunho -> review", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.contract.findUnique.mockResolvedValue(baseContract as never);
    mockPrisma.contract.update.mockResolvedValue({
      id: "c1",
      status: "review",
      updatedAt: new Date(),
    } as never);

    const res = await PATCH(makeReq(), { params: { id: "c1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("review");
  });
});
