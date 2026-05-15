import { describe, it, expect } from "vitest";
import { DEFAULT_SYSTEM_PROMPT, buildContextMessage } from "../prompts";

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof DEFAULT_SYSTEM_PROMPT).toBe("string");
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it("contains key legal phrases", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("contratos imobiliários");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("CONSULTA OBRIGATÓRIA");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("português brasileiro");
  });

  it("references relevant laws", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Lei 8.245/91");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("LGPD");
  });
});

describe("buildContextMessage", () => {
  it("includes dataJson rendered as markdown (post 2026-05 refactor)", () => {
    const result = buildContextMessage({
      dataJson: {
        vendedores: [{ tipo_pessoa: "fisica", nome: "João Silva", cpf: "11111111111", estado_civil: "Solteiro(a)", profissao: "Engenheiro" }],
      },
      htmlContent: "<p>test</p>",
      activeClauses: [],
    });
    // dataJsonToMarkdown processa campos canônicos: vendedores/compradores/imoveis/pagamento/comissao.
    // Output é markdown, não JSON stringified.
    expect(result).toContain("## DADOS DO CONTRATO");
    expect(result).toContain("### Vendedores");
    expect(result).toContain("João Silva");
  });

  it("includes clause list formatted as [category] title", () => {
    const result = buildContextMessage({
      dataJson: {},
      htmlContent: "<p>test</p>",
      activeClauses: [
        { title: "Objeto do Contrato", category: "objeto" },
        { title: "Penalidades", category: "penalidades" },
      ],
    });
    expect(result).toContain("- [objeto] Objeto do Contrato");
    expect(result).toContain("- [penalidades] Penalidades");
  });

  it("shows placeholder when no clauses", () => {
    const result = buildContextMessage({
      dataJson: {},
      htmlContent: "<p>test</p>",
      activeClauses: [],
    });
    expect(result).toContain("(nenhuma cláusula vinculada)");
  });

  it("truncates HTML at 8000 chars and appends marker", () => {
    const longHtml = "X".repeat(10000);
    const result = buildContextMessage({
      dataJson: {},
      htmlContent: longHtml,
      activeClauses: [],
    });
    expect(result).toContain("...(truncado)");
    // Should not contain the full 10000 chars
    expect(result.indexOf("X".repeat(8001))).toBe(-1);
  });

  it("includes full HTML when shorter than 8000 chars", () => {
    const shortHtml = "<p>Short content</p>";
    const result = buildContextMessage({
      dataJson: {},
      htmlContent: shortHtml,
      activeClauses: [],
    });
    expect(result).toContain(shortHtml);
    expect(result).not.toContain("...(truncado)");
  });

  it("handles empty dataJson gracefully", () => {
    const result = buildContextMessage({
      dataJson: {},
      htmlContent: "<p>test</p>",
      activeClauses: [],
    });
    // dataJsonToMarkdown retorna "(dataJson vazio)" pra objetos sem chaves
    expect(result).toContain("(dataJson vazio)");
  });
});
