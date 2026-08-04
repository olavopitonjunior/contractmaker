import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadScopedDeal } from "@/lib/deals/route-helpers";
import { can } from "@/lib/security/rbac/check";

vi.mock("@/lib/deals/route-helpers", () => ({
  loadScopedDeal: vi.fn(),
}));

vi.mock("@/lib/security/rbac/check", () => ({
  can: vi.fn(() => true),
}));

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

import { PATCH } from "../route";

const mockPrisma = vi.mocked(prisma);
const mockLoadScopedDeal = vi.mocked(loadScopedDeal);
const mockCan = vi.mocked(can);

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(true);
  mockLoadScopedDeal.mockResolvedValue({
    auth: {
      ident: { via: "session" },
      org: { id: "org-1" },
      actor: { effectiveUserId: "user-1" },
    },
    eff: {},
    deal: { id: "deal-1", managerUserId: "mgr-1" },
  } as never);
  mockPrisma.deal.update.mockResolvedValue({
    id: "deal-1",
    managerUserId: null,
    manager: null,
  } as never);
});

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/deals/deal-1/manager", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: { dealId: "deal-1" } };

describe("PATCH /api/deals/[dealId]/manager — remoção", () => {
  it("clear:true zera o gerente mesmo com a org exigindo gerente", async () => {
    // O toggle managerRequired governa a CRIAÇÃO de negócio, não a gestão de um
    // negócio existente — remover tem que continuar possível (fix 2026-08-04).
    mockPrisma.orgManagerSettings.findUnique.mockResolvedValue({
      managerRequired: true,
      permissionsJson: {},
    } as never);

    const res = await PATCH(makeReq({ clear: true }), params);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.managerUserId).toBeNull();
    expect(mockPrisma.deal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "deal-1" },
        data: { managerUserId: null },
      })
    );
  });

  it("remoção não consulta OrgManagerSettings", async () => {
    await PATCH(makeReq({ clear: true }), params);
    expect(mockPrisma.orgManagerSettings.findUnique).not.toHaveBeenCalled();
  });

  it("rejeita managerUserId e clear juntos", async () => {
    const res = await PATCH(makeReq({ managerUserId: "u2", clear: true }), params);
    expect(res.status).toBe(400);
    expect(mockPrisma.deal.update).not.toHaveBeenCalled();
  });

  it("atribuição exige membership na org", async () => {
    mockPrisma.orgMembership.findUnique.mockResolvedValue(null as never);
    const res = await PATCH(makeReq({ managerUserId: "de-fora" }), params);
    expect(res.status).toBe(400);
    expect(mockPrisma.deal.update).not.toHaveBeenCalled();
  });

  it("sem deal.manager.assign → 403", async () => {
    mockCan.mockReturnValue(false);
    const res = await PATCH(makeReq({ clear: true }), params);
    expect(res.status).toBe(403);
    expect(mockPrisma.deal.update).not.toHaveBeenCalled();
  });
});
