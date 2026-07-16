import { describe, it, expect } from "vitest";
import {
  DEAL_SOURCE_CHANNEL,
  DEAL_SOURCE_CHANNEL_LABEL,
} from "../source-channel";

describe("DEAL_SOURCE_CHANNEL", () => {
  const values = Object.values(DEAL_SOURCE_CHANNEL);

  it("valores são únicos (sem colisão de canal)", () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it("todo canal tem rótulo PT-BR", () => {
    for (const v of values) {
      expect(DEAL_SOURCE_CHANNEL_LABEL[v]).toBeTruthy();
    }
  });

  it("não há rótulo órfão (label sem canal correspondente)", () => {
    for (const k of Object.keys(DEAL_SOURCE_CHANNEL_LABEL)) {
      expect(values).toContain(k);
    }
  });

  it("valores são snake_case estáveis (contrato de dados p/ relatório)", () => {
    expect(DEAL_SOURCE_CHANNEL).toMatchObject({
      FORM_PUBLICO: "form_publico",
      UPLOAD_PROPOSTA: "upload_proposta",
      IMPORT_CONTRATO: "import_contrato",
      MANUAL: "manual",
      PROPOSTA: "proposta",
      LEAD: "lead",
      WIZARD: "wizard",
    });
  });
});
