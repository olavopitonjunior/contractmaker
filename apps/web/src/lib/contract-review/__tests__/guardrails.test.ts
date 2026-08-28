import { describe, expect, it } from "vitest";
import { validateReviewFindings, type RawReviewFinding } from "../guardrails";
import { LOCACAO_REVIEW_PLAYBOOK } from "../playbooks/locacao";

const DOC =
  "CLÁUSULA TERCEIRA — O aluguel mensal é de R$ 2.500,00 (dois mil e quinhentos reais), " +
  "vencível todo dia 05. CLÁUSULA QUARTA — A garantia da locação é o seguro fiança " +
  "contratado junto à Porto Seguro Companhia de Seguros Gerais.";

function finding(overrides: Partial<RawReviewFinding> = {}): RawReviewFinding {
  return {
    category: "dados_form",
    severity: "warning",
    title: "Aluguel divergente",
    finding: "O formulário diz R$ 2.300,00; o texto diz R$ 2.500,00.",
    selectedText: "O aluguel mensal é de R$ 2.500,00",
    ...overrides,
  };
}

function validate(findings: RawReviewFinding[], existing: string[] = []) {
  return validateReviewFindings(
    { findings, documentOk: findings.length === 0 },
    { docText: DOC, playbook: LOCACAO_REVIEW_PLAYBOOK, existingSelectedTexts: existing }
  );
}

describe("validateReviewFindings", () => {
  it("aceita achado com citação literal do documento", () => {
    const { accepted, violations } = validate([finding()]);
    expect(violations).toEqual([]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].category).toBe("dados_form");
  });

  it("descarta selectedText que não existe no documento (anti-alucinação)", () => {
    const { accepted, violations } = validate([
      finding({ selectedText: "O aluguel mensal é de R$ 9.999,99 inventado" }),
    ]);
    expect(accepted).toEqual([]);
    expect(violations[0].kind).toBe("selected_text_not_found");
  });

  it("citação sobrevive a diferenças de whitespace/caixa (normalização)", () => {
    const { accepted } = validate([
      finding({ selectedText: "o aluguel   mensal é de r$ 2.500,00" }),
    ]);
    expect(accepted).toHaveLength(1);
  });

  it("descarta categoria fora do playbook", () => {
    const { accepted, violations } = validate([
      finding({ category: "estilo_redacao" }),
    ]);
    expect(accepted).toEqual([]);
    expect(violations[0].kind).toBe("invalid_category");
  });

  it("clampa severidade desconhecida (e error) para warning", () => {
    const { accepted } = validate([
      finding({ severity: "error" }),
      finding({
        severity: "critical",
        selectedText: "A garantia da locação é o seguro fiança",
        title: "Outro achado",
      }),
    ]);
    expect(accepted.map((f) => f.severity)).toEqual(["warning", "warning"]);
  });

  it("descarta duplicata de comentário existente sobre o mesmo trecho", () => {
    const { accepted, violations } = validate(
      [finding()],
      ["O aluguel mensal é de R$ 2.500,00"]
    );
    expect(accepted).toEqual([]);
    expect(violations[0].kind).toBe("duplicate_existing");
  });

  it("descarta duplicata dentro do próprio lote", () => {
    const { accepted, violations } = validate([finding(), finding({ title: "Repetido" })]);
    expect(accepted).toHaveLength(1);
    expect(violations[0].kind).toBe("duplicate_in_batch");
  });

  it("descarta selectedText curto demais para ancorar", () => {
    const { violations } = validate([finding({ selectedText: "dia 05" })]);
    expect(violations[0].kind).toBe("selected_text_too_short");
  });

  it("corta acima de maxFindings preservando os primeiros", () => {
    const many = [
      finding(),
      finding({ selectedText: "vencível todo dia 05. CLÁUSULA QUARTA", title: "b" }),
      finding({ selectedText: "A garantia da locação é o seguro fiança", title: "c" }),
      finding({ selectedText: "contratado junto à Porto Seguro Companhia", title: "d" }),
      finding({ selectedText: "CLÁUSULA TERCEIRA — O aluguel mensal", title: "e" }),
      finding({ selectedText: "dois mil e quinhentos reais", title: "f" }),
      finding({ selectedText: "Porto Seguro Companhia de Seguros Gerais", title: "g" }),
    ];
    const { accepted, violations } = validate(many);
    expect(accepted.length).toBe(LOCACAO_REVIEW_PLAYBOOK.maxFindings);
    expect(violations.some((v) => v.kind === "over_max_findings")).toBe(true);
  });

  it("trunca título e selectedText nos limites", () => {
    const longText = "A garantia da locação é o seguro fiança contratado junto à Porto Seguro Companhia de Seguros Gerais.".repeat(4);
    const { accepted } = validate([
      finding({
        title: "T".repeat(200),
        selectedText: DOC.slice(DOC.indexOf("CLÁUSULA QUARTA")),
      }),
    ]);
    expect(longText.length).toBeGreaterThan(240);
    expect(accepted[0].title.length).toBeLessThanOrEqual(80);
    expect(accepted[0].selectedText.length).toBeLessThanOrEqual(240);
  });
});
