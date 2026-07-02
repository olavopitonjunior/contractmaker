import { describe, it, expect } from "vitest";
import { buildLeaseRecords, type LeaseInput } from "../aggregate-lease";

function lease(over: Partial<LeaseInput> = {}): LeaseInput {
  return {
    id: "L1",
    taxaAdminPercent: 10,
    regimeIr: "retem_imobiliaria",
    vigenciaInicio: new Date(Date.UTC(2025, 2, 10)),
    dataJson: { comissao: { numero_contrato: "145" } },
    property: {
      rua: "Rua A",
      numero: "100",
      bairro: "Centro",
      uf: "sp",
      cep: "01001-000",
      tipoDimob: "urbano",
      ownerships: [
        { percentual: 100, tipo: "proprietario_principal", owner: { id: "O1", nome: "Locador PF", cpfCnpj: "390.533.447-05", tipoPessoa: "fisica" } },
      ],
    },
    tenants: [{ tipo: "titular", tenant: { nome: "Locatário", cpfCnpj: "111.444.777-35" } }],
    rentCharges: [
      { valorBase: 3000, encargos: 200, paidAt: new Date(Date.UTC(2026, 0, 15)) }, // jan
      { valorBase: 3000, encargos: 200, paidAt: new Date(Date.UTC(2026, 1, 15)) }, // fev
    ],
    ...over,
  };
}

describe("buildLeaseRecords", () => {
  it("bucketiza por mês do paidAt e calcula rendimento/comissão/imposto", () => {
    const [r] = buildLeaseRecords(lease(), 2026);
    expect(r.recordId).toBe("lease:L1:0");
    expect(r.locador.cpfCnpj).toBe("39053344705");
    expect(r.locatario.cpfCnpj).toBe("11144477735");
    expect(r.numeroContrato).toBe("145");
    expect(r.dataContrato).toBe("2025-03-10");
    // Janeiro (índice 0): rendimento 3200, comissão 10%×3000=300, IRRF PF base 3000 → 68.56
    expect(r.meses[0].rendimento).toBeCloseTo(3200, 2);
    expect(r.meses[0].comissao).toBeCloseTo(300, 2);
    expect(r.meses[0].imposto).toBeCloseTo(68.56, 2);
    // Março (índice 2): sem pagamento → tudo 0
    expect(r.meses[2].rendimento).toBe(0);
    expect(r.totalRendimento).toBeCloseTo(6400, 2);
  });

  it("rateia por ownership.percentual (2 proprietários 50/50)", () => {
    const recs = buildLeaseRecords(
      lease({
        property: {
          rua: "Rua A", numero: "100", bairro: "Centro", uf: "SP", cep: "01001000", tipoDimob: "urbano",
          ownerships: [
            { percentual: 50, tipo: "proprietario", owner: { id: "O1", nome: "A", cpfCnpj: "39053344705", tipoPessoa: "fisica" } },
            { percentual: 50, tipo: "proprietario", owner: { id: "O2", nome: "B", cpfCnpj: "11144477735", tipoPessoa: "fisica" } },
          ],
        },
      }),
      2026
    );
    expect(recs).toHaveLength(2);
    expect(recs[0].meses[0].rendimento).toBeCloseTo(1600, 2); // metade de 3200
  });

  it("locador PJ → IRRF 0", () => {
    const [r] = buildLeaseRecords(
      lease({
        property: {
          rua: "R", numero: "1", bairro: "C", uf: "SP", cep: "01001000", tipoDimob: "urbano",
          ownerships: [{ percentual: 100, tipo: "proprietario_principal", owner: { id: "O1", nome: "Empresa", cpfCnpj: "11222333000181", tipoPessoa: "juridica" } }],
        },
      }),
      2026
    );
    expect(r.meses[0].imposto).toBe(0);
  });

  it("sem aluguel recebido no ano → []", () => {
    expect(buildLeaseRecords(lease({ rentCharges: [] }), 2026)).toEqual([]);
  });
});
