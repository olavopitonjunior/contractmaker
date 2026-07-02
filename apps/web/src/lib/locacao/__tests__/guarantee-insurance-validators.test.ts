import { describe, it, expect } from "vitest";
import {
  guaranteeCreateSchema,
  guaranteeUpdateSchema,
  insuranceWizardSchema,
  insurancePolicyUpdateSchema,
  GUARANTEE_STATUSES,
  GUARANTEE_STATUS_LABELS,
  INSURANCE_STATUSES,
} from "../validators";

describe("validators — garantia locatícia e wizard de seguro", () => {
  // ============================================================================
  // guaranteeCreateSchema (união discriminada por tipo)
  // ============================================================================
  describe("guaranteeCreateSchema", () => {
    it("aceita fiador com dados PF", () => {
      const r = guaranteeCreateSchema.safeParse({
        tipo: "fiador",
        leaseContractId: "lc_x",
        fiador: { nome: "João da Silva", cpf: "12345678901", rendaMensal: 8000 },
      });
      expect(r.success).toBe(true);
      if (r.success && r.data.tipo === "fiador") {
        expect(r.data.fiador.nome).toBe("João da Silva");
        expect(r.data.status).toBe("pendente");
        expect(r.data.substituir).toBe(false);
      }
    });

    it("rejeita fiador sem o objeto fiador", () => {
      const r = guaranteeCreateSchema.safeParse({
        tipo: "fiador",
        leaseContractId: "lc_x",
      });
      expect(r.success).toBe(false);
    });

    it("aceita seguro_fianca com provider e prêmio", () => {
      const r = guaranteeCreateSchema.safeParse({
        tipo: "seguro_fianca",
        leaseContractId: "lc_x",
        provider: "Porto Seguro",
        premioMensal: 250,
        coberturaMeses: 12,
      });
      expect(r.success).toBe(true);
    });

    it("rejeita titulo_capitalizacao sem valorTitulo", () => {
      const r = guaranteeCreateSchema.safeParse({
        tipo: "titulo_capitalizacao",
        leaseContractId: "lc_x",
        provider: "PortoCap",
      });
      expect(r.success).toBe(false);
    });

    it("aceita caução com subtipo default e dados de depósito", () => {
      const r = guaranteeCreateSchema.safeParse({
        tipo: "caucao",
        leaseContractId: "lc_x",
        valorCaucao: 6000,
        dadosDeposito: { banco: "Itaú", conta: "12345-6", dataDeposito: "2026-06-01" },
      });
      expect(r.success).toBe(true);
      if (r.success && r.data.tipo === "caucao") {
        expect(r.data.caucaoSubtipo).toBe("valor");
        expect(r.data.dadosDeposito?.dataDeposito).toBeInstanceOf(Date);
      }
    });

    it("aceita garantia_digital com substituir=true", () => {
      const r = guaranteeCreateSchema.safeParse({
        tipo: "garantia_digital",
        leaseContractId: "lc_x",
        provider: "credpago",
        taxaMensal: 180,
        substituir: true,
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.substituir).toBe(true);
    });

    it("rejeita tipo desconhecido", () => {
      const r = guaranteeCreateSchema.safeParse({
        tipo: "aval_bancario",
        leaseContractId: "lc_x",
      });
      expect(r.success).toBe(false);
    });
  });

  // ============================================================================
  // guaranteeUpdateSchema + união de status (novo lifecycle + legados)
  // ============================================================================
  describe("guaranteeUpdateSchema / GUARANTEE_STATUSES", () => {
    it("aceita todos os status do lifecycle novo E os legados", () => {
      for (const status of GUARANTEE_STATUSES) {
        const r = guaranteeUpdateSchema.safeParse({ status });
        expect(r.success, `status ${status} deveria ser aceito`).toBe(true);
      }
    });

    it("mapeia labels dos legados pros equivalentes novos", () => {
      expect(GUARANTEE_STATUS_LABELS["ativa"]).toBe("Vigente");
      expect(GUARANTEE_STATUS_LABELS["acionada"]).toBe("Executada");
      expect(GUARANTEE_STATUS_LABELS["encerrada"]).toBe("Finalizada");
    });

    it("rejeita status fora da união", () => {
      const r = guaranteeUpdateSchema.safeParse({ status: "quebrada" });
      expect(r.success).toBe(false);
    });
  });

  // ============================================================================
  // insuranceWizardSchema
  // ============================================================================
  describe("insuranceWizardSchema", () => {
    const base = {
      leaseContractId: "lc_x",
      seguradora: "Porto Seguro",
      vigenciaInicio: "2026-07-01",
      vigenciaFim: "2027-07-01",
      gerarDespesa: false,
    };

    it("aceita cotação mínima com defaults (tipo incêndio, responsável locatário)", () => {
      const r = insuranceWizardSchema.safeParse(base);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.tipo).toBe("seguro_incendio");
        expect(r.data.responsavelPagamento).toBe("locatario");
      }
    });

    it("preenche coberturas básicas por default no coberturaJson", () => {
      const r = insuranceWizardSchema.safeParse({
        ...base,
        coberturaJson: { coberturaValor: 300000, adicionais: ["vendaval"] },
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.coberturaJson?.basicas).toEqual(["incendio", "raio", "explosao"]);
        expect(r.data.coberturaJson?.adicionais).toEqual(["vendaval"]);
      }
    });

    it("rejeita vigenciaFim <= vigenciaInicio", () => {
      const r = insuranceWizardSchema.safeParse({
        ...base,
        vigenciaFim: "2026-07-01",
      });
      expect(r.success).toBe(false);
    });

    it("rejeita gerarDespesa sem premioMensal", () => {
      const r = insuranceWizardSchema.safeParse({ ...base, gerarDespesa: true });
      expect(r.success).toBe(false);
    });

    it("rejeita gerarDespesa quando a imobiliária paga o prêmio", () => {
      const r = insuranceWizardSchema.safeParse({
        ...base,
        gerarDespesa: true,
        premioMensal: 45,
        responsavelPagamento: "imobiliaria",
      });
      expect(r.success).toBe(false);
    });

    it("aceita gerarDespesa com prêmio e locatário pagando", () => {
      const r = insuranceWizardSchema.safeParse({
        ...base,
        gerarDespesa: true,
        premioMensal: 45,
        apoliceNumero: "AP-123",
      });
      expect(r.success).toBe(true);
    });
  });

  // ============================================================================
  // insurancePolicyUpdateSchema
  // ============================================================================
  describe("insurancePolicyUpdateSchema", () => {
    it("aceita transição de status do lifecycle novo", () => {
      for (const status of INSURANCE_STATUSES) {
        const r = insurancePolicyUpdateSchema.safeParse({ status });
        expect(r.success, `status ${status} deveria ser aceito`).toBe(true);
      }
    });

    it("rejeita status desconhecido", () => {
      const r = insurancePolicyUpdateSchema.safeParse({ status: "suspensa" });
      expect(r.success).toBe(false);
    });
  });
});
