import { describe, it, expect } from "vitest";
import {
  expenseCreateSchema,
  propertyOwnershipReplaceSchema,
  leaseAngariadorCreateSchema,
  insurancePolicyCreateSchema,
  debtAgreementCreateSchema,
} from "../validators";

describe("validators de locação — entidades operacionais", () => {
  // ============================================================================
  // Expense
  // ============================================================================
  describe("expenseCreateSchema", () => {
    it("aceita despesa válida (IPTU parcelado vinculado a contrato)", () => {
      const r = expenseCreateSchema.safeParse({
        leaseContractId: "lc_x",
        type: "iptu",
        valor: 600,
        dueDate: new Date("2026-06-10"),
        parcelaN: 3,
        parcelaTotal: 10,
        debitoDe: "locatario",
        creditoPara: "imobiliaria",
      });
      expect(r.success).toBe(true);
    });

    it("rejeita despesa sem contrato e sem imóvel", () => {
      const r = expenseCreateSchema.safeParse({
        type: "iptu",
        valor: 600,
        dueDate: new Date("2026-06-10"),
        debitoDe: "locatario",
        creditoPara: "imobiliaria",
      });
      expect(r.success).toBe(false);
    });

    it("rejeita parcelaN > parcelaTotal", () => {
      const r = expenseCreateSchema.safeParse({
        leaseContractId: "lc_x",
        type: "condominio",
        valor: 400,
        dueDate: new Date("2026-06-10"),
        parcelaN: 5,
        parcelaTotal: 3,
        debitoDe: "locatario",
        creditoPara: "imobiliaria",
      });
      expect(r.success).toBe(false);
    });

    it("força taxa_locacao a ser à vista (parcelaTotal=1)", () => {
      const r = expenseCreateSchema.safeParse({
        leaseContractId: "lc_x",
        type: "taxa_locacao",
        valor: 1200,
        dueDate: new Date("2026-06-10"),
        parcelaN: 1,
        parcelaTotal: 3,
        debitoDe: "proprietario",
        creditoPara: "imobiliaria",
      });
      expect(r.success).toBe(false);
    });
  });

  // ============================================================================
  // PropertyOwnership (refine soma = 100)
  // ============================================================================
  describe("propertyOwnershipReplaceSchema", () => {
    it("aceita 4 proprietários × 25% (cenário Superlógica)", () => {
      const r = propertyOwnershipReplaceSchema.safeParse({
        ownerships: [
          { ownerId: "o1", percentual: 25, tipo: "proprietario_principal" },
          { ownerId: "o2", percentual: 25, tipo: "proprietario" },
          { ownerId: "o3", percentual: 25, tipo: "proprietario" },
          { ownerId: "o4", percentual: 25, tipo: "proprietario" },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("rejeita soma diferente de 100", () => {
      const r = propertyOwnershipReplaceSchema.safeParse({
        ownerships: [
          { ownerId: "o1", percentual: 50 },
          { ownerId: "o2", percentual: 40 },
        ],
      });
      expect(r.success).toBe(false);
    });

    it("aceita 100 exato com tolerância (33.33 + 33.33 + 33.34)", () => {
      const r = propertyOwnershipReplaceSchema.safeParse({
        ownerships: [
          { ownerId: "o1", percentual: 33.33 },
          { ownerId: "o2", percentual: 33.33 },
          { ownerId: "o3", percentual: 33.34 },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("rejeita 2+ proprietários principais", () => {
      const r = propertyOwnershipReplaceSchema.safeParse({
        ownerships: [
          { ownerId: "o1", percentual: 50, tipo: "proprietario_principal" },
          { ownerId: "o2", percentual: 50, tipo: "proprietario_principal" },
        ],
      });
      expect(r.success).toBe(false);
    });
  });

  // ============================================================================
  // LeaseAngariador (XOR percentual/valorFixo conforme formaComissao)
  // ============================================================================
  describe("leaseAngariadorCreateSchema", () => {
    it("aceita percentual quando formaComissao=percentual", () => {
      const r = leaseAngariadorCreateSchema.safeParse({
        partyId: "po_x",
        formaComissao: "percentual",
        percentual: 10,
        mesesComissao: 12,
      });
      expect(r.success).toBe(true);
    });

    it("aceita valorFixo quando formaComissao=valor_fixo", () => {
      const r = leaseAngariadorCreateSchema.safeParse({
        partyId: "po_x",
        formaComissao: "valor_fixo",
        valorFixo: 500,
      });
      expect(r.success).toBe(true);
    });

    it("rejeita formaComissao=percentual sem percentual", () => {
      const r = leaseAngariadorCreateSchema.safeParse({
        partyId: "po_x",
        formaComissao: "percentual",
      });
      expect(r.success).toBe(false);
    });

    it("aceita mesesComissao=null (por todo o contrato)", () => {
      const r = leaseAngariadorCreateSchema.safeParse({
        partyId: "po_x",
        formaComissao: "percentual",
        percentual: 5,
        mesesComissao: null,
      });
      expect(r.success).toBe(true);
    });
  });

  // ============================================================================
  // InsurancePolicy
  // ============================================================================
  describe("insurancePolicyCreateSchema", () => {
    it("aceita apólice válida", () => {
      const r = insurancePolicyCreateSchema.safeParse({
        leaseContractId: "lc_x",
        tipo: "seguro_incendio",
        seguradora: "Tokio Marine",
        vigenciaInicio: new Date("2026-01-01"),
        vigenciaFim: new Date("2027-01-01"),
        responsavelPagamento: "locatario",
      });
      expect(r.success).toBe(true);
    });

    it("rejeita vigenciaFim ≤ vigenciaInicio", () => {
      const r = insurancePolicyCreateSchema.safeParse({
        propertyId: "p_x",
        tipo: "seguro_incendio",
        seguradora: "Porto",
        vigenciaInicio: new Date("2026-01-01"),
        vigenciaFim: new Date("2025-12-31"),
      });
      expect(r.success).toBe(false);
    });

    it("rejeita apólice sem contrato e sem imóvel", () => {
      const r = insurancePolicyCreateSchema.safeParse({
        tipo: "seguro_incendio",
        seguradora: "Mapfre",
        vigenciaInicio: new Date("2026-01-01"),
        vigenciaFim: new Date("2027-01-01"),
      });
      expect(r.success).toBe(false);
    });
  });

  // ============================================================================
  // DebtAgreement (valorTotal = soma dos componentes)
  // ============================================================================
  describe("debtAgreementCreateSchema", () => {
    it("calcula valorTotal automaticamente", () => {
      const r = debtAgreementCreateSchema.safeParse({
        leaseContractId: "lc_x",
        tenantId: "t_x",
        componentes: {
          aluguel: 2000,
          multa: 200,
          juros: 100,
          honorarios: 500,
          custas: 0,
          atualizacao: 50,
        },
        parcelas: 6,
        primeiraDataDue: new Date("2026-07-10"),
      });
      expect(r.success).toBe(true);
      if (r.success) {
        // valorTotal = 2000 + 200 + 100 + 500 + 50 = 2850
        expect(r.data.valorTotal).toBeCloseTo(2850, 2);
      }
    });

    it("rejeita acordo com todos os componentes zerados", () => {
      const r = debtAgreementCreateSchema.safeParse({
        leaseContractId: "lc_x",
        tenantId: "t_x",
        componentes: {
          aluguel: 0,
          multa: 0,
          juros: 0,
          honorarios: 0,
          custas: 0,
          atualizacao: 0,
        },
        parcelas: 6,
        primeiraDataDue: new Date("2026-07-10"),
      });
      expect(r.success).toBe(false);
    });
  });
});
