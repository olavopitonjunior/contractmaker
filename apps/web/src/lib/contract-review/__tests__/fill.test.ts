import { describe, expect, it } from "vitest";
import { buildFillReport, labelForToken, parseFillReport, tokenNameOf } from "../fill";
import { placeholderFillChecks } from "../checks";
import { buildGenerationPlan, parseGenerationPlan } from "../plan";

/**
 * O laudo lê o que o replace e o cleanup já devolviam e os call sites jogavam
 * fora. Aqui não há Drive: os dois retornos são simulados com o shape real
 * (`occurrencesByToken` de replacePlaceholdersInDoc; `{{token}}` crus de
 * cleanupOrphanPlaceholders).
 */

const MAP = {
  locadores_qualificacao: "Ana Ribeiro, brasileira, CPF 529.982.247-25",
  locatarios_qualificacao: "",
  imovel_endereco_completo: "Rua das Flores, 10",
  imovel_identificacao: "",
  aluguel_valor: "R$ 2.500,00 (dois mil e quinhentos reais)",
  aluguel_dia_vencimento: "",
  clausula_garantia: "",
  contrato_numero: "LOC-0001",
};

describe("buildFillReport", () => {
  it("separa preenchido, vazio-obrigatório e vazio-opcional; ignora token fora do Doc", () => {
    const fill = buildFillReport({
      occurrencesByToken: {
        locadores_qualificacao: 1,
        locatarios_qualificacao: 1,
        imovel_endereco_completo: 2,
        imovel_identificacao: 3,
        aluguel_valor: 2,
        aluguel_dia_vencimento: 2,
        clausula_garantia: 0, // o modelo NÃO tem o token — não é campo vazio
        contrato_numero: 1,
      },
      replacements: MAP,
      orphansRemoved: [],
      modalidade: "locacao",
    });
    expect(fill.filled).toBe(4);
    expect(fill.empty).toEqual([
      // obrigatórios primeiro, alfabético dentro do grupo
      { token: "imovel_identificacao", occurrences: 3, required: true },
      { token: "locatarios_qualificacao", occurrences: 1, required: true },
      { token: "aluguel_dia_vencimento", occurrences: 2, required: false },
    ]);
    expect(fill.unknown).toEqual([]);
  });

  it("órfão apagado vira chave desconhecida, com e sem espaços, sem duplicar", () => {
    const fill = buildFillReport({
      occurrencesByToken: {},
      replacements: {},
      orphansRemoved: ["{{taxa_administracao}}", "{{ taxa_administracao }}", "{{foro}}"],
      modalidade: "locacao",
    });
    expect(fill.unknown).toEqual(["foro", "taxa_administracao"]);
  });

  it("sem modalidade nenhum campo é obrigatório — nunca inventa gravidade", () => {
    const fill = buildFillReport({
      occurrencesByToken: { imovel_identificacao: 1 },
      replacements: { imovel_identificacao: "" },
      orphansRemoved: [],
      modalidade: null,
    });
    expect(fill.empty[0].required).toBe(false);
  });

  it("valor só de espaços conta como vazio", () => {
    const fill = buildFillReport({
      occurrencesByToken: { aluguel_valor: 1 },
      replacements: { aluguel_valor: "   " },
      orphansRemoved: [],
      modalidade: "locacao",
    });
    expect(fill.empty.map((e) => e.token)).toEqual(["aluguel_valor"]);
    expect(fill.filled).toBe(0);
  });

  it("tokenNameOf tolera o que não é token e NUNCA devolve chaves coladas", () => {
    expect(tokenNameOf("{{ x }}")).toBe("x");
    expect(tokenNameOf("texto solto")).toBe("texto solto");
    // Órfão digitado à mão, com espaço — o cleanup captura, e a tela
    // reembrulha em {{…}}: sem isto sairia `{{{{nome do locador}}}}`.
    expect(tokenNameOf("{{nome do locador}}")).toBe("nome do locador");
    expect(tokenNameOf("{{ nome do locador }}")).toBe("nome do locador");
  });

  it("labelForToken usa o catálogo e cai no token cru fora dele", () => {
    expect(labelForToken("aluguel_dia_vencimento", "locacao")).toBe("Dia de vencimento");
    expect(labelForToken("aluguel_dia_vencimento", "a_vista")).toBe("aluguel_dia_vencimento");
    expect(labelForToken("x", null)).toBe("x");
  });
});

describe("parseFillReport", () => {
  it("aceita o que buildFillReport produz e recusa o malformado", () => {
    const fill = buildFillReport({
      occurrencesByToken: { a: 1 },
      replacements: { a: "" },
      orphansRemoved: ["{{b}}"],
      modalidade: null,
    });
    expect(parseFillReport(JSON.parse(JSON.stringify(fill)))).toEqual(fill);
    expect(parseFillReport(null)).toBeNull();
    expect(parseFillReport({ version: 99 })).toBeNull();
    expect(parseFillReport({ version: 1, empty: "x", unknown: [], filled: 0 })).toBeNull();
    expect(parseFillReport({ version: 1, empty: [{ token: 1 }], unknown: [], filled: 0 })).toBeNull();
  });
});

describe("placeholderFillChecks", () => {
  const plan = () =>
    buildGenerationPlan({
      family: "locacao",
      template: { id: "tpl", name: "Fiador", engine: "google_docs", modalidade: "locacao" },
      manualTemplate: false,
    });

  it("plano sem laudo (geração anterior à feature) → nada", () => {
    expect(placeholderFillChecks(plan())).toEqual([]);
  });

  it("obrigatório vazio → um aviso POR campo, com rótulo do catálogo; opcionais → um agregado", () => {
    const p = plan();
    p.fill = buildFillReport({
      occurrencesByToken: {
        imovel_identificacao: 2,
        locatarios_qualificacao: 1,
        aluguel_dia_vencimento: 1,
        aluguel_iptu: 1,
      },
      replacements: {
        imovel_identificacao: "",
        locatarios_qualificacao: "",
        aluguel_dia_vencimento: "",
        aluguel_iptu: "",
      },
      orphansRemoved: [],
      modalidade: "locacao",
    });
    const findings = placeholderFillChecks(p);
    const obrig = findings.filter((f) => f.category === "campo_obrigatorio_vazio");
    expect(obrig).toHaveLength(2);
    expect(obrig[0].message).toContain("«Identificação do imóvel»");
    expect(obrig[0].message).toContain("em 2 trechos");
    expect(obrig[0].selectedText).toBe("campo:imovel_identificacao");
    const opc = findings.filter((f) => f.category === "campo_vazio");
    expect(opc).toHaveLength(1);
    expect(opc[0].message).toContain("2 campos saíram em branco");
    expect(opc[0].message).toContain("«Dia de vencimento»");
    // Tudo aviso — geração nunca é bloqueada por campo vazio (decisão do dono).
    expect(findings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("chave que o sistema não produz → um aviso agregado", () => {
    const p = plan();
    p.fill = buildFillReport({
      occurrencesByToken: {},
      replacements: {},
      orphansRemoved: ["{{taxa_administracao}}"],
      modalidade: "locacao",
    });
    const findings = placeholderFillChecks(p);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("chave_desconhecida");
    expect(findings[0].message).toContain("{{taxa_administracao}}");
    expect(findings[0].selectedText).toBe("chaves-desconhecidas:taxa_administracao");
  });

  it("dedupe é estável: o mesmo laudo produz o mesmo selectedText duas vezes", () => {
    const build = () => {
      const p = plan();
      p.fill = buildFillReport({
        occurrencesByToken: { aluguel_iptu: 1, aluguel_dia_vencimento: 1 },
        replacements: { aluguel_iptu: "", aluguel_dia_vencimento: "" },
        orphansRemoved: [],
        modalidade: "locacao",
      });
      return placeholderFillChecks(p).map((f) => f.selectedText);
    };
    expect(build()).toEqual(build());
  });

  it("laudo malformado no jsonb é descartado sem derrubar o plano", () => {
    const p = plan();
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    raw.fill = { version: 1, empty: "não é lista", unknown: [], filled: 0 };
    const parsed = parseGenerationPlan(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.fill).toBeUndefined();
    // O executor não tem try/catch nos checks — isto tem de ser [] e não lançar.
    expect(placeholderFillChecks(parsed!)).toEqual([]);
  });

  it("o laudo sobrevive ao round-trip pelo jsonb do plano", () => {
    const p = plan();
    p.fill = buildFillReport({
      occurrencesByToken: { aluguel_valor: 1 },
      replacements: { aluguel_valor: "" },
      orphansRemoved: [],
      modalidade: "locacao",
    });
    const parsed = parseGenerationPlan(JSON.parse(JSON.stringify(p)));
    expect(parsed).not.toBeNull();
    expect(placeholderFillChecks(parsed!)).toHaveLength(1);
  });
});
