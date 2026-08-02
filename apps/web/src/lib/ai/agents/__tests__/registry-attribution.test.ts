/**
 * O que este arquivo protege: a contabilidade do painel de custo.
 *
 * Cada operação do AIUsage pertence a EXATAMENTE um destes mundos: um agente
 * (via OPERATION_TO_AGENT), o grupo Infraestrutura (INFRA_OPERATIONS), a lista
 * de ambíguas (call-site carimba explícito) ou "não atribuído" consciente
 * (`doc_analysis`, sem escritor vivo). Uma operação em dois mundos ao mesmo
 * tempo dobra a linha num painel que agrupa dos dois jeitos — e ninguém
 * percebe até o total não bater.
 */

import { describe, it, expect } from "vitest";
import {
  AGENT_KEYS,
  AGENT_REGISTRY,
  AMBIGUOUS_OPERATIONS,
  INFRA_OPERATIONS,
  OPERATION_TO_AGENT,
} from "../registry";

describe("atribuição de operações", () => {
  it("nenhuma operação vive em dois mundos", () => {
    const owned = new Set(Object.keys(OPERATION_TO_AGENT));
    for (const op of INFRA_OPERATIONS) {
      expect(owned.has(op), `${op} está em INFRA e tem dono`).toBe(false);
      expect(
        AMBIGUOUS_OPERATIONS.has(op),
        `${op} está em INFRA e em ambíguas`
      ).toBe(false);
    }
    for (const op of AMBIGUOUS_OPERATIONS) {
      expect(owned.has(op), `${op} é ambígua e tem dono na derivação`).toBe(
        false
      );
    }
  });

  it("as órfãs do painel de produção ganharam dono", () => {
    // Eram 26,2% do custo sem atribuição (US$ 2,15 de US$ 8,20).
    expect(OPERATION_TO_AGENT["template_placeholder_insertion"]).toBe("ocr");
    expect(OPERATION_TO_AGENT["dimob_review"]).toBe("insights");
    expect(OPERATION_TO_AGENT["dimob_diagnose"]).toBe("insights");
    expect(OPERATION_TO_AGENT["dimob_explain"]).toBe("insights");
    expect(OPERATION_TO_AGENT["survey_summary"]).toBe("insights");
    expect(OPERATION_TO_AGENT["clause_generate"]).toBe("curator");
  });

  it("infraestrutura não é agente — e está toda listada", () => {
    for (const op of [
      "embed_kb",
      "embed_memory",
      "embed_query",
      "summarize_memory",
      "intent_classify",
      "sentinel_classify",
      "knowledge_upload_classification",
    ]) {
      expect(INFRA_OPERATIONS.has(op), `${op} fora do grupo Infraestrutura`).toBe(
        true
      );
    }
  });

  it("doc_analysis segue sem dono de propósito (operação morta)", () => {
    expect(OPERATION_TO_AGENT["doc_analysis"]).toBeUndefined();
    expect(INFRA_OPERATIONS.has("doc_analysis")).toBe(false);
  });

  it("o agregador existe no registry e não promete controle que não honra", () => {
    expect(AGENT_KEYS).toContain("aggregator");
    const def = AGENT_REGISTRY.aggregator;
    expect(def.supports).toEqual({
      enabled: false,
      model: false,
      instructions: false,
      ragScope: false,
    });
    // `chat` é ambígua — o agregador NÃO pode reivindicá-la na derivação,
    // senão o histórico inteiro do legado migra pra ele.
    expect(def.operations).toHaveLength(0);
    expect(def.tenantEditable).toBe(false);
  });
});
