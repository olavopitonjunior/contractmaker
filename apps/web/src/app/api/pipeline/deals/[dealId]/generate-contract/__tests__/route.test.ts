import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/context", () => ({
  requireAuth: vi.fn().mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "org1" } }),
}));
vi.mock("@/lib/deals/route-helpers", () => ({ guardDealScope: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/services/contract-generation", () => ({
  generateContractForDeal: vi.fn().mockResolvedValue({ contractId: "c1", version: 1 }),
  generateLocacaoContractForDeal: vi.fn().mockResolvedValue({ contractId: "c1", version: 1 }),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

import { POST } from "../route";
import { generateContractForDeal, generateLocacaoContractForDeal } from "@/lib/services/contract-generation";

const dealFindUnique = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;
const req = () => new NextRequest("http://localhost/api/pipeline/deals/d1/generate-contract", { method: "POST" });
const params = { params: { dealId: "d1" } };

const COMPLETO = {
  locadores: [{ tipo_pessoa: "fisica", nome: "João Locador" }],
  locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária" }],
  aluguel: { valor: 2500 },
};

beforeEach(() => vi.clearAllMocks());

describe("POST generate-contract — contrato de locação não sai sem as partes", () => {
  it("locação sem locador → 422 dizendo o que falta, e o gerador NÃO roda", async () => {
    dealFindUnique.mockResolvedValue({
      kind: "locacao",
      form: { schemaType: "locacao_residencial_v1", dataJson: { locatarios: COMPLETO.locatarios, aluguel: { valor: 2500 } } },
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.incomplete).toBe(true);
    expect(body.missing).toContain("locadores");
    expect(body.error).toMatch(/locador/i);
    expect(generateLocacaoContractForDeal).not.toHaveBeenCalled();
  });

  it("locação completa → gera normalmente", async () => {
    dealFindUnique.mockResolvedValue({ kind: "locacao", form: { schemaType: "locacao_residencial_v1", dataJson: COMPLETO } });
    expect((await POST(req(), params)).status).toBe(201);
    expect(generateLocacaoContractForDeal).toHaveBeenCalled();
  });

  it("VENDA não é julgada por esta régua — segue como antes", async () => {
    dealFindUnique.mockResolvedValue({ kind: "venda", form: { schemaType: "compra_venda_v1", dataJson: {} } });
    expect((await POST(req(), params)).status).toBe(201);
    expect(generateContractForDeal).toHaveBeenCalled();
  });

  it("negócio sem formulário não é bloqueado (nada a julgar)", async () => {
    dealFindUnique.mockResolvedValue({ kind: "locacao", form: null });
    expect((await POST(req(), params)).status).toBe(201);
    expect(generateLocacaoContractForDeal).toHaveBeenCalled();
  });
});
