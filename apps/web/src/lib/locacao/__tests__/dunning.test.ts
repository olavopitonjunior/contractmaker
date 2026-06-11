import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub `@/lib/db/prisma` antes do import do executor.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    rentCharge: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    newtonRequest: { create: vi.fn() },
  },
}));

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn(),
}));

import { prisma } from "@/lib/db/prisma";
import { dunningExecutor } from "../executors/dunning";

const prismaMock = prisma as unknown as {
  rentCharge: { findFirst: ReturnType<typeof vi.fn> };
  deal: { findFirst: ReturnType<typeof vi.fn> };
  newtonRequest: { create: ReturnType<typeof vi.fn> };
};

describe("dunning executor (régua de cobrança)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 404 se RentCharge não existe na org", async () => {
    prismaMock.rentCharge.findFirst.mockResolvedValueOnce(null);
    const res = await dunningExecutor({
      rentChargeId: "rc_missing",
      orgId: "o_x",
      userId: "u_x",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("não encontrado");
  });

  it("escolhe stage formal_d_plus_5 quando 5 dias de atraso", async () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    prismaMock.rentCharge.findFirst.mockResolvedValueOnce({
      id: "rc_1",
      dueDate: fiveDaysAgo,
      competencia: "2026-05",
      valorBase: 2000,
      leaseContract: {
        dealId: "d_x",
        tenants: [
          {
            tipo: "titular",
            tenant: { id: "t_x", nome: "João", phone: "5511999990000" },
          },
        ],
        property: { rua: "Rua A", numero: "123" },
      },
    });
    prismaMock.deal.findFirst.mockResolvedValueOnce({ id: "d_x" });
    prismaMock.newtonRequest.create.mockResolvedValueOnce({ id: "nr_x" });

    const res = await dunningExecutor({
      rentChargeId: "rc_1",
      orgId: "o_x",
      userId: "u_x",
    });
    expect(res.ok).toBe(true);
    expect(res.requestId).toBe("nr_x");
    const callArg = prismaMock.newtonRequest.create.mock.calls[0][0];
    expect(callArg.data.priority).toBe("normal"); // d+5 ainda não é high
    expect(callArg.data.ask).toContain("atraso há 5 dias");
  });

  it("escolhe stage extrajudicial_d_plus_30 com priority high", async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 35);
    prismaMock.rentCharge.findFirst.mockResolvedValueOnce({
      id: "rc_2",
      dueDate: thirtyDaysAgo,
      competencia: "2026-04",
      valorBase: 1500,
      leaseContract: {
        dealId: "d_y",
        tenants: [
          {
            tipo: "titular",
            tenant: { id: "t_y", nome: "Ana", phone: null },
          },
        ],
        property: { rua: "Rua B", numero: "45" },
      },
    });
    prismaMock.deal.findFirst.mockResolvedValueOnce({ id: "d_y" });
    prismaMock.newtonRequest.create.mockResolvedValueOnce({ id: "nr_y" });

    const res = await dunningExecutor({
      rentChargeId: "rc_2",
      orgId: "o_x",
      userId: "u_x",
    });
    expect(res.ok).toBe(true);
    const callArg = prismaMock.newtonRequest.create.mock.calls[0][0];
    expect(callArg.data.priority).toBe("high");
    expect(callArg.data.targetType).toBe("group"); // tenant sem phone → group
  });

  it("rejeita se LeaseContract não tem dealId", async () => {
    prismaMock.rentCharge.findFirst.mockResolvedValueOnce({
      id: "rc_3",
      dueDate: new Date(),
      competencia: "2026-05",
      valorBase: 2000,
      leaseContract: {
        dealId: null,
        tenants: [],
        property: { rua: "X", numero: "1" },
      },
    });

    const res = await dunningExecutor({
      rentChargeId: "rc_3",
      orgId: "o_x",
      userId: "u_x",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("dealId");
  });
});
