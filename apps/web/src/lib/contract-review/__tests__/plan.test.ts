import { describe, expect, it } from "vitest";
import {
  EVIDENCE_HEAD_CHARS,
  GENERATION_PLAN_VERSION,
  buildGenerationPlan,
  normalizeEvidenceText,
  parseGenerationPlan,
} from "../plan";

describe("buildGenerationPlan", () => {
  it("monta o plano de locação com seleção, garantia, slots e evidência", () => {
    const clause =
      "<p>Cláusula de <b>Seguro Fiança</b> — a apólice contratada junto à " +
      "seguradora garante as obrigações locatícias.</p>";
    const plan = buildGenerationPlan({
      family: "locacao",
      template: {
        id: "tpl1",
        name: "Locação Residencial — Seguro Fiança",
        engine: "google_docs",
        modalidade: "locacao",
      },
      manualTemplate: false,
      garantiaMatched: true,
      dataJson: { garantia: { tipo: "seguro_fianca", provider: "Porto Seguro" } },
      slots: {
        values: { slot_garantia: clause },
        resolved: [
          {
            slot: "garantia",
            value: "seguro_fianca",
            source: "knowledge",
            knowledgeItemId: "ki1",
          },
        ],
        failures: [],
      },
    });

    expect(plan.version).toBe(GENERATION_PLAN_VERSION);
    expect(plan.family).toBe("locacao");
    expect(plan.selection).toEqual({ manual: false, garantiaMatched: true });
    expect(plan.garantia).toEqual({ tipo: "seguro_fianca", provider: "Porto Seguro" });
    expect(plan.slots?.resolved).toHaveLength(1);
    expect(plan.slotEvidence).toHaveLength(1);
    const evidence = plan.slotEvidence![0];
    expect(evidence.slot).toBe("garantia");
    expect(evidence.knowledgeItemId).toBe("ki1");
    // Evidência normalizada: sem tags, minúscula, colapsada.
    expect(evidence.contentHead).toContain("cláusula de seguro fiança");
    expect(evidence.contentHead.length).toBeLessThanOrEqual(EVIDENCE_HEAD_CHARS);
  });

  it("registra escolha manual e templateNotice do D16", () => {
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "Padrão", engine: "handlebars", modalidade: "locacao" },
      manualTemplate: true,
      templateNotice: "Sem modelo próprio de Caução — gerado com o padrão.",
      dataJson: { garantia: { tipo: "caucao" } },
    });
    expect(plan.selection.manual).toBe(true);
    expect(plan.selection.garantiaMatched).toBeUndefined();
    expect(plan.selection.templateNotice).toMatch(/Sem modelo próprio/);
    expect(plan.garantia).toEqual({ tipo: "caucao", provider: null });
    expect(plan.slots).toBeUndefined();
    expect(plan.slotEvidence).toBeUndefined();
  });

  it("normaliza o tipo legado de garantia e ignora provider vazio", () => {
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "X", engine: "handlebars" },
      manualTemplate: false,
      dataJson: { garantia: { tipo: "garantia_digital", provider: "   " } },
    });
    expect(plan.garantia).toEqual({ tipo: "garantia_onerosa", provider: null });
  });

  it("venda: sem garantia nem slots; modalidade do template", () => {
    const plan = buildGenerationPlan({
      family: "venda",
      template: { id: "t", name: "CCV Financiamento", engine: "handlebars", modalidade: "financiamento" },
      manualTemplate: false,
      dataJson: { pagamento: { valor_total: 500000 } },
    });
    expect(plan.family).toBe("venda");
    expect(plan.modalidade).toBe("financiamento");
    expect(plan.garantia).toBeUndefined();
    expect(plan.slots).toBeUndefined();
  });

  it("slot resolvido sem conteúdo em values não gera evidência", () => {
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "X", engine: "handlebars" },
      manualTemplate: false,
      slots: {
        values: {},
        resolved: [{ slot: "garantia", value: null, source: "fallback" }],
        failures: [],
      },
    });
    expect(plan.slots?.resolved).toHaveLength(1);
    expect(plan.slotEvidence).toBeUndefined();
  });
});

describe("parseGenerationPlan", () => {
  it("round-trip: o que build produz, parse aceita", () => {
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "X", engine: "handlebars", modalidade: "locacao" },
      manualTemplate: false,
      garantiaMatched: false,
      templateNotice: "aviso",
    });
    const parsed = parseGenerationPlan(JSON.parse(JSON.stringify(plan)));
    expect(parsed).toEqual(plan);
  });

  it.each([
    ["null", null],
    ["array", []],
    ["string", "plan"],
    ["sem version", { family: "locacao", templateId: "t" }],
    ["versão desconhecida", { version: 99, family: "locacao", templateId: "t", templateName: "X", engine: "h", selection: { manual: false } }],
    ["family inválida", { version: 1, family: "aditivo", templateId: "t", templateName: "X", engine: "h", selection: { manual: false } }],
    ["templateId vazio", { version: 1, family: "venda", templateId: "", templateName: "X", engine: "h", selection: { manual: false } }],
    ["selection sem manual", { version: 1, family: "venda", templateId: "t", templateName: "X", engine: "h", selection: {} }],
  ])("malformado (%s) → null", (_label, raw) => {
    expect(parseGenerationPlan(raw)).toBeNull();
  });
});

describe("normalizeEvidenceText", () => {
  it("remove tags, decodifica entidades e colapsa whitespace", () => {
    expect(normalizeEvidenceText("<p>A&nbsp; B &amp; C</p>\n\n  D")).toBe("a b & c d");
  });
});
