import { describe, it, expect, vi, beforeEach } from "vitest";

// O setup global mocka @/lib/db/prisma — extendemos com envelope.
vi.mock("@/lib/db/prisma", async () => {
  const actual = await vi.importActual<{ prisma: Record<string, unknown> }>(
    "@/lib/db/prisma"
  );
  const envelope = {
    findUnique: vi.fn(),
  };
  return {
    prisma: {
      ...(actual?.prisma ?? {}),
      envelope,
      // garante que deal.findUnique e deal.update sejam vi.fn (override do setup)
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

import { autoPromoteDealOnContractSigned } from "../auto-promote-signed";
import { prisma } from "@/lib/db/prisma";

const mockEnvelopeFindUnique = vi.mocked(prisma.envelope.findUnique);
const mockDealFindUnique = vi.mocked(prisma.deal.findUnique);
const mockDealUpdate = vi.mocked(prisma.deal.update);

beforeEach(() => {
  vi.clearAllMocks();
});

function pipelineWithStages() {
  return {
    id: "pipe-1",
    stages: [
      { id: "s-form", name: "Formulário" },
      { id: "s-conf", name: "Confecção de Contrato" },
      { id: "s-env", name: "Enviado para assinatura" },
      { id: "s-sign", name: "Contrato assinado" },
      { id: "s-cob", name: "Cobrança emitida" },
      { id: "s-pago", name: "Comissão paga" },
    ],
  };
}

describe("autoPromoteDealOnContractSigned", () => {
  it("promove deal de 'Enviado para assinatura' pra 'Contrato assinado'", async () => {
    mockEnvelopeFindUnique.mockResolvedValueOnce({
      id: "env-1",
      orgId: "org-1",
      source: "contract",
      dealId: "deal-1",
    } as never);
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-env", name: "Enviado para assinatura" },
      pipeline: pipelineWithStages(),
    } as never);
    mockDealUpdate.mockResolvedValueOnce({} as never);

    const result = await autoPromoteDealOnContractSigned("env-1");

    expect(result).toEqual({
      promoted: true,
      fromStageId: "s-env",
      toStageId: "s-sign",
    });
    expect(mockDealUpdate).toHaveBeenCalledWith({
      where: { id: "deal-1" },
      data: { stageId: "s-sign" },
    });
  });

  it("não promove envelope de attachment (avulso)", async () => {
    mockEnvelopeFindUnique.mockResolvedValueOnce({
      id: "env-1",
      orgId: "org-1",
      source: "attachment",
      dealId: "deal-1",
    } as never);

    const result = await autoPromoteDealOnContractSigned("env-1");

    expect(result).toEqual({
      promoted: false,
      reason: "not_contract_envelope",
    });
    expect(mockDealUpdate).not.toHaveBeenCalled();
  });

  it("é idempotente quando deal já está em 'Contrato assinado'", async () => {
    mockEnvelopeFindUnique.mockResolvedValueOnce({
      id: "env-1",
      orgId: "org-1",
      source: "contract",
      dealId: "deal-1",
    } as never);
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-sign", name: "Contrato assinado" },
      pipeline: pipelineWithStages(),
    } as never);

    const result = await autoPromoteDealOnContractSigned("env-1");

    expect(result).toEqual({ promoted: false, reason: "already_advanced" });
    expect(mockDealUpdate).not.toHaveBeenCalled();
  });

  it("não regride deal que já está em 'Cobrança emitida'", async () => {
    mockEnvelopeFindUnique.mockResolvedValueOnce({
      id: "env-1",
      orgId: "org-1",
      source: "contract",
      dealId: "deal-1",
    } as never);
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-cob", name: "Cobrança emitida" },
      pipeline: pipelineWithStages(),
    } as never);

    const result = await autoPromoteDealOnContractSigned("env-1");

    expect(result).toEqual({ promoted: false, reason: "already_advanced" });
    expect(mockDealUpdate).not.toHaveBeenCalled();
  });

  it("retorna stage_missing quando pipeline não tem 'Contrato assinado'", async () => {
    mockEnvelopeFindUnique.mockResolvedValueOnce({
      id: "env-1",
      orgId: "org-1",
      source: "contract",
      dealId: "deal-1",
    } as never);
    mockDealFindUnique.mockResolvedValueOnce({
      id: "deal-1",
      stage: { id: "s-env", name: "Enviado para assinatura" },
      pipeline: {
        id: "pipe-custom",
        stages: [
          { id: "s-form", name: "Formulário" },
          { id: "s-conf", name: "Confecção de Contrato" },
          { id: "s-env", name: "Enviado para assinatura" },
          // sem "Contrato assinado" — pipeline customizado pré-migration
        ],
      },
    } as never);

    const result = await autoPromoteDealOnContractSigned("env-1");

    expect(result).toEqual({ promoted: false, reason: "stage_missing" });
    expect(mockDealUpdate).not.toHaveBeenCalled();
  });

  it("retorna envelope_not_found quando o envelope não existe", async () => {
    mockEnvelopeFindUnique.mockResolvedValueOnce(null as never);
    const result = await autoPromoteDealOnContractSigned("nonexistent");
    expect(result).toEqual({ promoted: false, reason: "envelope_not_found" });
  });
});
