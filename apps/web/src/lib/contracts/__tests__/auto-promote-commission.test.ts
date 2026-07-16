import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", async () => {
  const actual = await vi.importActual<{ prisma: Record<string, unknown> }>(
    "@/lib/db/prisma"
  );
  return {
    prisma: {
      ...(actual?.prisma ?? {}),
      deal: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue({}),
}));

import { autoPromoteDealOnCommissionPaid } from "../auto-promote-commission";
import { prisma } from "@/lib/db/prisma";

const mockDealFindUnique = vi.mocked(prisma.deal.findUnique);
const mockDealUpdate = vi.mocked(prisma.deal.update);

beforeEach(() => {
  vi.clearAllMocks();
});

function pipeline() {
  return {
    id: "pipe-1",
    orgId: "org-1",
    stages: [
      { id: "s-cob", name: "Cobrança emitida" },
      { id: "s-pago", name: "Comissão paga" },
      { id: "s-lost", name: "Negócio perdido" },
    ],
  };
}

describe("autoPromoteDealOnCommissionPaid", () => {
  it("promove de 'Cobrança emitida' pra 'Comissão paga' + seta commissionPaidAt", async () => {
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-cob", name: "Cobrança emitida" },
      pipeline: pipeline(),
    } as never);
    mockDealUpdate.mockResolvedValueOnce({} as never);

    const result = await autoPromoteDealOnCommissionPaid("deal-1");

    expect(result).toEqual({ promoted: true, fromStageId: "s-cob", toStageId: "s-pago" });
    expect(mockDealUpdate).toHaveBeenCalledWith({
      where: { id: "deal-1" },
      data: {
        stageId: "s-pago",
        stageEnteredAt: expect.any(Date),
        commissionPaidAt: expect.any(Date),
      },
    });
  });

  it("também aceita 'Contrato assinado' como origem", async () => {
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-sign", name: "Contrato assinado" },
      pipeline: pipeline(),
    } as never);
    mockDealUpdate.mockResolvedValueOnce({} as never);

    const result = await autoPromoteDealOnCommissionPaid("deal-1");
    expect(result).toMatchObject({ promoted: true, toStageId: "s-pago" });
  });

  it("no_deal quando dealId ausente (charge avulsa sem deal)", async () => {
    const result = await autoPromoteDealOnCommissionPaid(null);
    expect(result).toEqual({ promoted: false, reason: "no_deal" });
    expect(mockDealFindUnique).not.toHaveBeenCalled();
  });

  it("não regride deal já em 'Comissão paga' (idempotente)", async () => {
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-pago", name: "Comissão paga" },
      pipeline: pipeline(),
    } as never);

    const result = await autoPromoteDealOnCommissionPaid("deal-1");
    expect(result).toEqual({ promoted: false, reason: "already_advanced" });
    expect(mockDealUpdate).not.toHaveBeenCalled();
  });

  it("não promove deal em 'Negócio perdido'", async () => {
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-lost", name: "Negócio perdido" },
      pipeline: pipeline(),
    } as never);

    const result = await autoPromoteDealOnCommissionPaid("deal-1");
    expect(result).toEqual({ promoted: false, reason: "already_advanced" });
    expect(mockDealUpdate).not.toHaveBeenCalled();
  });

  it("stage_missing quando o pipeline não tem 'Comissão paga' (ex.: locação)", async () => {
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-cob", name: "Cobrança emitida" },
      pipeline: {
        id: "pipe-loc",
        orgId: "org-1",
        stages: [{ id: "s-cob", name: "Cobrança emitida" }],
      },
    } as never);

    const result = await autoPromoteDealOnCommissionPaid("deal-1");
    expect(result).toEqual({ promoted: false, reason: "stage_missing" });
    expect(mockDealUpdate).not.toHaveBeenCalled();
  });
});
