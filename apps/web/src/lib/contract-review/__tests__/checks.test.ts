import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clausePlanChecks } from "../checks";
import { buildGenerationPlan, normalizeEvidenceText } from "../plan";

// Corpus real: minuta de seguro-fiança da Ativa (a mesma dos few-shots do
// playbook de ingestão) faz de "documento gerado" nos testes golden.
const FIXTURES = join(__dirname, "..", "..", "templates", "__tests__", "fixtures", "ativa-residencial");
const porto = readFileSync(join(FIXTURES, "03-RES-PORTO-SEGURO.txt"), "utf8");

function planWithClause(clauseHtml: string, opts?: { provider?: string | null }) {
  return buildGenerationPlan({
    family: "locacao",
    template: { id: "tpl", name: "Seguro Fiança", engine: "google_docs", modalidade: "locacao" },
    manualTemplate: false,
    garantiaMatched: true,
    dataJson: {
      garantia: { tipo: "seguro_fianca", provider: opts?.provider ?? "Porto Seguro" },
    },
    slots: {
      values: { slot_garantia: clauseHtml },
      resolved: [
        { slot: "garantia", value: "seguro_fianca", source: "knowledge", knowledgeItemId: "ki1" },
      ],
      failures: [],
    },
  });
}

describe("clausePlanChecks — golden com corpus real", () => {
  // Trecho literal da minuta — a cláusula "eleita" existe no documento.
  const clauseFromDoc = porto
    .split("\n")
    .filter((l) => normalizeEvidenceText(l).includes("porto seguro"))
    .join("\n")
    .slice(0, 400);

  it("cláusula presente + seguradora citada → zero findings", () => {
    const plan = planWithClause(clauseFromDoc);
    expect(clausePlanChecks(plan, porto)).toEqual([]);
  });

  it("cláusula removida do documento → clausula_ausente", () => {
    const plan = planWithClause(clauseFromDoc);
    const docSemClausula = porto.replace(/porto seguro/gi, "");
    const findings = clausePlanChecks(plan, docSemClausula);
    const categories = findings.map((f) => f.category);
    expect(categories).toContain("clausula_ausente");
    expect(findings.every((f) => f.severity !== ("error" as string))).toBe(true);
  });

  it("seguradora da concorrente no form → provider_ausente", () => {
    const plan = planWithClause(clauseFromDoc, { provider: "Pottencial" });
    const findings = clausePlanChecks(plan, porto);
    expect(findings.map((f) => f.category)).toContain("provider_ausente");
  });
});

describe("clausePlanChecks — casos unitários", () => {
  it("failures do slot viram warning humanizado com sugestão", () => {
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "SF", engine: "handlebars" },
      manualTemplate: false,
      dataJson: { garantia: { tipo: "seguro_fianca", provider: "Azul" } },
      slots: {
        values: {},
        resolved: [{ slot: "garantia", value: "seguro_fianca", source: "fallback" }],
        failures: [
          { slot: "garantia", reason: "provider_mismatch", message: "sem cláusula da Azul" },
        ],
      },
    });
    const findings = clausePlanChecks(plan, "corpo qualquer");
    const failure = findings.find((f) => f.category === "slot_fallback");
    expect(failure?.severity).toBe("warning");
    expect(failure?.message).toMatch(/cláusula genérica/);
    expect(failure?.suggestedFix).toMatch(/Seguradoras e prestadoras/);
    // Fallback genérico → o nome da prestadora não é cobrado no texto.
    expect(findings.map((f) => f.category)).not.toContain("provider_ausente");
  });

  it("garantiaMatched=false persiste o aviso D16", () => {
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "Padrão", engine: "handlebars" },
      manualTemplate: false,
      garantiaMatched: false,
      templateNotice: "Sem modelo próprio de Caução — gerado com o padrão.",
      dataJson: { garantia: { tipo: "caucao" } },
    });
    const findings = clausePlanChecks(plan, "corpo");
    const d16 = findings.find((f) => f.category === "template_fallback");
    expect(d16?.severity).toBe("warning");
    expect(d16?.message).toMatch(/Sem modelo próprio/);
  });

  it("cláusula da plataforma → info", () => {
    const clause = "Cláusula neutra de garantia com texto suficiente para evidência.";
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "SF", engine: "handlebars" },
      manualTemplate: false,
      dataJson: { garantia: { tipo: "seguro_fianca" } },
      slots: {
        values: { slot_garantia: clause },
        resolved: [
          { slot: "garantia", value: "seguro_fianca", source: "knowledge", knowledgeItemId: "kp", fromPlatform: true },
        ],
        failures: [],
      },
    });
    const findings = clausePlanChecks(plan, `preâmbulo ${clause} fecho`);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("clausula_plataforma");
    expect(findings[0].severity).toBe("info");
  });

  it("plano de venda sem slots → nenhum finding", () => {
    const plan = buildGenerationPlan({
      family: "venda",
      template: { id: "t", name: "CCV", engine: "handlebars", modalidade: "a_vista" },
      manualTemplate: false,
      dataJson: {},
    });
    expect(clausePlanChecks(plan, "qualquer corpo")).toEqual([]);
  });

  it("evidência sobrevive ao round-trip HTML → texto do Doc", () => {
    const clauseHtml =
      "<p><b>CLÁUSULA DÉCIMA</b> — A garantia da presente locação é o <i>seguro fiança</i>, contratado junto à Porto&nbsp;Seguro.</p>";
    const docText =
      "…\nCLÁUSULA DÉCIMA — A garantia da presente locação é o seguro fiança, contratado junto à Porto Seguro.\n…";
    const plan = planWithClause(clauseHtml);
    expect(clausePlanChecks(plan, docText)).toEqual([]);
  });
});
