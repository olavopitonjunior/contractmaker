import { describe, it, expect } from "vitest";
import { simulateRepasse, type ChargeInput } from "../repasse-simulator";

function mkCharge(overrides: Partial<ChargeInput> = {}): ChargeInput {
  return {
    rentChargeId: "rc1",
    competencia: "2026-05",
    valorBase: 1000,
    encargos: 0,
    taxaAdminPercent: 10,
    regimeIr: "nao_retem",
    ownerships: [{ ownerId: "o1", nome: "Owner 1", percentual: 100 }],
    ...overrides,
  };
}

describe("simulateRepasse", () => {
  it("retorna zeros quando sem cobranças", () => {
    const r = simulateRepasse([]);
    expect(r.totalBruto).toBe(0);
    expect(r.totalTaxaAdm).toBe(0);
    expect(r.totalIrRetido).toBe(0);
    expect(r.porProprietario).toEqual([]);
  });

  it("calcula líquido sem IR quando regime !== retem_imobiliaria", () => {
    const r = simulateRepasse([mkCharge()]);
    expect(r.totalBruto).toBe(1000);
    expect(r.totalTaxaAdm).toBe(100);
    expect(r.totalIrRetido).toBe(0);
    expect(r.totalLiquidoProprietarios).toBeCloseTo(900, 5);
  });

  it("retém IR 27.5% sobre valorBase quando retem_imobiliaria", () => {
    const r = simulateRepasse([
      mkCharge({ regimeIr: "retem_imobiliaria", valorBase: 1000, encargos: 200 }),
    ]);
    expect(r.totalBruto).toBe(1200);
    expect(r.totalTaxaAdm).toBe(120);
    expect(r.totalIrRetido).toBeCloseTo(275, 5);
    expect(r.totalLiquidoProprietarios).toBeCloseTo(805, 5);
  });

  it("divide entre proprietários conforme percentual e mantém ordem desc", () => {
    const r = simulateRepasse([
      mkCharge({
        ownerships: [
          { ownerId: "a", nome: "A", percentual: 30 },
          { ownerId: "b", nome: "B", percentual: 70 },
        ],
      }),
    ]);
    expect(r.porProprietario[0]?.ownerId).toBe("b");
    expect(r.porProprietario[0]?.valorLiquido).toBeCloseTo(630, 5);
    expect(r.porProprietario[1]?.valorLiquido).toBeCloseTo(270, 5);
  });

  it("acumula múltiplas cobranças pro mesmo owner", () => {
    const r = simulateRepasse([
      mkCharge({ rentChargeId: "1" }),
      mkCharge({ rentChargeId: "2" }),
    ]);
    expect(r.porProprietario).toHaveLength(1);
    expect(r.porProprietario[0]?.valorLiquido).toBeCloseTo(1800, 5);
  });

  it("preserva detalhes por charge", () => {
    const r = simulateRepasse([
      mkCharge({ rentChargeId: "x", competencia: "2026-04" }),
    ]);
    expect(r.detalhes).toHaveLength(1);
    expect(r.detalhes[0]).toMatchObject({
      rentChargeId: "x",
      competencia: "2026-04",
      taxaAdmAplicada: 100,
    });
  });
});
