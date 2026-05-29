import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    leaseContract: { findFirst: vi.fn() },
    propertyOwner: { findFirst: vi.fn() },
    rentCharge: { aggregate: vi.fn(), findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import { runAssistantTool, ASSISTANT_TOOLS } from "@/lib/ai/assistant-tools";

const mocks = prisma as unknown as {
  leaseContract: { findFirst: ReturnType<typeof vi.fn> };
  propertyOwner: { findFirst: ReturnType<typeof vi.fn> };
  rentCharge: { aggregate: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
};

describe("ASSISTANT_TOOLS registry", () => {
  it("expõe as 4 tools esperadas", () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "forecast_cashflow",
      "query_lease_status",
      "suggest_dunning_strategy",
      "summarize_owner_position",
    ]);
  });
});

describe("runAssistantTool — query_lease_status", () => {
  it("retorna snapshot do contrato encontrado", async () => {
    mocks.leaseContract.findFirst.mockResolvedValueOnce({
      status: "ativo",
      valorAluguel: 2500,
      diaVencimento: 10,
      vigenciaFim: new Date("2027-01-01"),
      dataProximoReajuste: new Date("2026-06-01"),
      property: { rua: "Rua X", numero: "10", cidade: "SP" },
      tenants: [{ tenant: { nome: "João" } }],
      rentCharges: [
        { competencia: "2026-05", status: "paga", valorBase: 2500, encargos: 0, multa: 0, juros: 0 },
      ],
      guarantee: { tipo: "fiador", status: "ativa" },
    });
    const result = await runAssistantTool(
      "query_lease_status",
      { leaseContractId: "lc1" },
      { orgId: "o1" }
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("ativo");
    expect(parsed.valorAluguel).toBe(2500);
    expect(parsed.inquilinos).toEqual(["João"]);
    expect(parsed.cobrancasRecentes).toHaveLength(1);
  });

  it("retorna erro se contrato não existe", async () => {
    mocks.leaseContract.findFirst.mockResolvedValueOnce(null);
    const result = await runAssistantTool(
      "query_lease_status",
      { leaseContractId: "missing" },
      { orgId: "o1" }
    );
    expect(JSON.parse(result)).toEqual({ error: "Contrato não encontrado" });
  });
});

describe("runAssistantTool — suggest_dunning_strategy", () => {
  it("recomenda formal_d_plus_5 quando 5 dias de atraso", async () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    mocks.leaseContract.findFirst.mockResolvedValueOnce({
      rentCharges: [{ id: "rc1", dueDate: fiveDaysAgo }],
      guarantee: { tipo: "fiador", status: "ativa" },
    });
    const result = await runAssistantTool(
      "suggest_dunning_strategy",
      { leaseContractId: "lc1" },
      { orgId: "o1" }
    );
    const parsed = JSON.parse(result);
    expect(parsed.recommendation).toBe("formal_d_plus_5");
    expect(parsed.acao).toContain("/api/locacao/rent-charges/rc1/remind");
  });

  it("retorna sem ação quando sem cobrança pendente", async () => {
    mocks.leaseContract.findFirst.mockResolvedValueOnce({
      rentCharges: [],
      guarantee: null,
    });
    const result = await runAssistantTool(
      "suggest_dunning_strategy",
      { leaseContractId: "lc1" },
      { orgId: "o1" }
    );
    const parsed = JSON.parse(result);
    expect(parsed.recommendation).toBe("Sem cobrança pendente. Nada a cobrar.");
  });
});

describe("runAssistantTool — tool desconhecida", () => {
  it("retorna erro pra tool inválida", async () => {
    const result = await runAssistantTool(
      "nao_existe",
      {},
      { orgId: "o1" }
    );
    expect(JSON.parse(result)).toMatchObject({ error: expect.stringContaining("desconhecida") });
  });
});
