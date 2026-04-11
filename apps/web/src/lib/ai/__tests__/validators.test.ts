import { describe, it, expect } from "vitest";
import { validateCPF, validateCNPJ, validateContractData } from "../validators";
import { createTestContractData } from "@/__tests__/helpers";

// ==========================================
// validateCPF
// ==========================================
describe("validateCPF", () => {
  it("accepts valid CPF with formatting", () => {
    expect(validateCPF("529.982.247-25")).toBe(true);
  });

  it("accepts valid CPF as raw digits", () => {
    expect(validateCPF("52998224725")).toBe(true);
  });

  it("accepts another valid CPF", () => {
    expect(validateCPF("453.178.287-91")).toBe(true);
  });

  it("rejects CPF with wrong check digit", () => {
    expect(validateCPF("529.982.247-26")).toBe(false);
  });

  it("rejects CPF with all same digits", () => {
    expect(validateCPF("111.111.111-11")).toBe(false);
    expect(validateCPF("000.000.000-00")).toBe(false);
    expect(validateCPF("99999999999")).toBe(false);
  });

  it("rejects CPF with wrong length (10 digits)", () => {
    expect(validateCPF("5299822472")).toBe(false);
  });

  it("rejects CPF with wrong length (12 digits)", () => {
    expect(validateCPF("529982247251")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateCPF("")).toBe(false);
  });

  it("rejects CPF with letters", () => {
    expect(validateCPF("529.982.abc-25")).toBe(false);
  });
});

// ==========================================
// validateCNPJ
// ==========================================
describe("validateCNPJ", () => {
  it("accepts valid CNPJ with formatting", () => {
    expect(validateCNPJ("11.222.333/0001-81")).toBe(true);
  });

  it("accepts valid CNPJ as raw digits", () => {
    expect(validateCNPJ("11222333000181")).toBe(true);
  });

  it("rejects CNPJ with wrong check digit", () => {
    expect(validateCNPJ("11.222.333/0001-82")).toBe(false);
  });

  it("rejects CNPJ with all same digits", () => {
    expect(validateCNPJ("11.111.111/1111-11")).toBe(false);
    expect(validateCNPJ("00000000000000")).toBe(false);
  });

  it("rejects CNPJ with wrong length", () => {
    expect(validateCNPJ("1122233300018")).toBe(false);
    expect(validateCNPJ("112223330001811")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateCNPJ("")).toBe(false);
  });
});

// ==========================================
// validateContractData
// ==========================================
describe("validateContractData", () => {
  // --- Payment sum ---
  describe("payment validation", () => {
    it("returns no payment error when sum matches total", () => {
      const data = createTestContractData();
      const issues = validateContractData(data);
      const paymentError = issues.find(
        (i) => i.field === "pagamento" && i.severity === "error"
      );
      expect(paymentError).toBeUndefined();
    });

    it("returns error when sum differs from total by more than R$1", () => {
      const data = createTestContractData({
        pagamento: {
          valor_total: 500000,
          sinal_arras: 50000,
          recursos_proprios: 100000, // Changed from 200000
          fgts: 0,
          cessao_consorcio: 0,
          alienacao_fiduciaria: 250000,
          outras_formas: 0,
        },
      });
      const issues = validateContractData(data);
      const paymentError = issues.find(
        (i) => i.field === "pagamento" && i.severity === "error"
      );
      expect(paymentError).toBeDefined();
      expect(paymentError!.message).toContain("Soma dos componentes");
    });

    it("returns error when valor_total is zero", () => {
      const data = createTestContractData({
        pagamento: {
          valor_total: 0,
          sinal_arras: 0,
          recursos_proprios: 0,
          fgts: 0,
          cessao_consorcio: 0,
          alienacao_fiduciaria: 0,
          outras_formas: 0,
        },
      });
      const issues = validateContractData(data);
      const zeroError = issues.find(
        (i) => i.field === "pagamento.valor_total" && i.severity === "error"
      );
      expect(zeroError).toBeDefined();
    });

    it("tolerates R$1 floating point difference", () => {
      const data = createTestContractData({
        pagamento: {
          valor_total: 500000,
          sinal_arras: 50000,
          recursos_proprios: 200000.5,
          fgts: 0,
          cessao_consorcio: 0,
          alienacao_fiduciaria: 249999.9,
          outras_formas: 0,
        },
      });
      const issues = validateContractData(data);
      const paymentError = issues.find(
        (i) => i.field === "pagamento" && i.severity === "error"
      );
      expect(paymentError).toBeUndefined();
    });
  });

  // --- CPF validation ---
  describe("CPF validation", () => {
    it("returns error for invalid vendor CPF", () => {
      const data = createTestContractData({
        vendedores: [
          { nome: "João", cpf: "111.111.111-11", estado_civil: "Solteiro(a)" },
        ],
      });
      const issues = validateContractData(data);
      const cpfError = issues.find(
        (i) => i.field === "vendedores[0].cpf" && i.severity === "error"
      );
      expect(cpfError).toBeDefined();
      expect(cpfError!.message).toContain("inválido");
    });

    it("returns warning for missing vendor CPF", () => {
      const data = createTestContractData({
        vendedores: [{ nome: "João", cpf: "", estado_civil: "Solteiro(a)" }],
      });
      const issues = validateContractData(data);
      const cpfWarning = issues.find(
        (i) => i.field === "vendedores[0].cpf" && i.severity === "warning"
      );
      expect(cpfWarning).toBeDefined();
      expect(cpfWarning!.message).toContain("não preenchido");
    });

    it("returns error for invalid buyer CPF", () => {
      const data = createTestContractData({
        compradores: [{ nome: "Maria", cpf: "000.000.000-00" }],
      });
      const issues = validateContractData(data);
      const cpfError = issues.find(
        (i) => i.field === "compradores[0].cpf" && i.severity === "error"
      );
      expect(cpfError).toBeDefined();
    });

    it("returns no CPF error for valid CPFs", () => {
      const data = createTestContractData();
      const issues = validateContractData(data);
      const cpfErrors = issues.filter(
        (i) => i.field.includes("cpf") && i.severity === "error"
      );
      expect(cpfErrors).toHaveLength(0);
    });
  });

  // --- Spouse validation ---
  describe("spouse validation", () => {
    it("returns error when married vendor has no spouse", () => {
      const data = createTestContractData({
        vendedores: [
          {
            nome: "João",
            cpf: "529.982.247-25",
            estado_civil: "Casado(a)",
          },
        ],
      });
      const issues = validateContractData(data);
      const spouseError = issues.find(
        (i) => i.field === "vendedores[0].conjuge" && i.severity === "error"
      );
      expect(spouseError).toBeDefined();
      expect(spouseError!.message).toContain("cônjuge");
    });

    it("returns error for 'Uniao Estavel' without spouse", () => {
      const data = createTestContractData({
        vendedores: [
          {
            nome: "João",
            cpf: "529.982.247-25",
            estado_civil: "Uniao Estavel",
          },
        ],
      });
      const issues = validateContractData(data);
      const spouseError = issues.find(
        (i) => i.field === "vendedores[0].conjuge"
      );
      expect(spouseError).toBeDefined();
    });

    it("returns error for 'União Estável' (with accents) without spouse", () => {
      const data = createTestContractData({
        vendedores: [
          {
            nome: "João",
            cpf: "529.982.247-25",
            estado_civil: "União Estável",
          },
        ],
      });
      const issues = validateContractData(data);
      const spouseError = issues.find(
        (i) => i.field === "vendedores[0].conjuge"
      );
      expect(spouseError).toBeDefined();
    });

    it("returns no spouse error for single vendor", () => {
      const data = createTestContractData({
        vendedores: [
          {
            nome: "João",
            cpf: "529.982.247-25",
            estado_civil: "Solteiro(a)",
          },
        ],
      });
      const issues = validateContractData(data);
      const spouseError = issues.find((i) => i.field.includes("conjuge"));
      expect(spouseError).toBeUndefined();
    });

    it("returns no spouse error when married vendor has spouse data", () => {
      const data = createTestContractData({
        vendedores: [
          {
            nome: "João",
            cpf: "529.982.247-25",
            estado_civil: "Casado(a)",
            conjuge: { nome: "Maria" },
          },
        ],
      });
      const issues = validateContractData(data);
      const spouseError = issues.find(
        (i) => i.field === "vendedores[0].conjuge"
      );
      expect(spouseError).toBeUndefined();
    });
  });

  // --- Scenario-based clauses ---
  describe("scenario-based suggestions", () => {
    it("suggests suspensive condition when alienacao_fiduciaria > 0", () => {
      const data = createTestContractData();
      const issues = validateContractData(data);
      const financing = issues.find(
        (i) => i.severity === "info" && i.message.includes("alienação fiduciária")
      );
      expect(financing).toBeDefined();
    });

    it("suggests tenant preference when occupied by third party", () => {
      const data = createTestContractData({ ocupacao: "ocupado-terceiro" });
      const issues = validateContractData(data);
      const tenant = issues.find(
        (i) => i.severity === "info" && i.message.includes("locatário")
      );
      expect(tenant).toBeDefined();
    });

    it("warns on financed property with >15% discrepancy", () => {
      const data = createTestContractData({
        status_propriedade: "financiado-saldo",
        saldo_devedor: 100000,
        pagamento: {
          valor_total: 500000,
          sinal_arras: 50000,
          recursos_proprios: 200000,
          fgts: 0,
          cessao_consorcio: 0,
          alienacao_fiduciaria: 250000, // 150% of saldo_devedor
          outras_formas: 0,
        },
      });
      const issues = validateContractData(data);
      const discrepancy = issues.find(
        (i) =>
          i.field === "pagamento.alienacao_fiduciaria" &&
          i.severity === "warning"
      );
      expect(discrepancy).toBeDefined();
    });
  });

  // --- Missing config / signature ---
  describe("missing fields", () => {
    it("warns when config is missing", () => {
      const data = createTestContractData({ config: undefined });
      const issues = validateContractData(data);
      const configWarning = issues.find(
        (i) => i.field === "config" && i.severity === "warning"
      );
      expect(configWarning).toBeDefined();
    });

    it("warns when signature data is missing", () => {
      const data = createTestContractData({ assinatura: undefined });
      const issues = validateContractData(data);
      const sigWarning = issues.find(
        (i) => i.field === "assinatura" && i.severity === "warning"
      );
      expect(sigWarning).toBeDefined();
    });
  });

  // --- Empty object ---
  it("handles empty data object without crashing", () => {
    const issues = validateContractData({});
    expect(Array.isArray(issues)).toBe(true);
  });

  it("handles data with no pagamento field", () => {
    const issues = validateContractData({ vendedores: [], compradores: [] });
    expect(Array.isArray(issues)).toBe(true);
  });
});
