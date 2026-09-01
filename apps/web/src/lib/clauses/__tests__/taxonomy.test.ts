import { describe, it, expect } from "vitest";
import {
  esteiraForModalidade,
  esteiraForContext,
  axisFor,
  groupCodeFor,
  visibleEsteiras,
  ESTEIRA_AXIS,
  ESTEIRA_PRIMARY_FIXTURE,
} from "@/lib/clauses/taxonomy";
import { CLAUSE_PREVIEW_MODALIDADE_VALUES } from "@/lib/clauses/schema";

describe("esteiraForModalidade", () => {
  it("cobre as 6 modalidades com fixture de preview", () => {
    const map: Record<string, "venda" | "locacao"> = {
      a_vista: "venda",
      financiamento: "venda",
      locacao: "locacao",
      locacao_comercial: "locacao",
      temporada: "locacao",
      // Apesar do prefixo, administração de locação É locação —
      // LOCACAO_MODALIDADES a inclui, e templateFamilyForModalidade concorda.
      administracao_locacao: "locacao",
    };
    for (const m of CLAUSE_PREVIEW_MODALIDADE_VALUES) {
      expect(esteiraForModalidade(m), m).toBe(map[m]);
    }
  });

  it("proposta não estreita a busca", () => {
    expect(esteiraForModalidade("proposta_venda")).toBeNull();
    expect(esteiraForModalidade("proposta_locacao_residencial")).toBeNull();
  });

  it("vazio e desconhecido devolvem null", () => {
    expect(esteiraForModalidade(null)).toBeNull();
    expect(esteiraForModalidade("")).toBeNull();
  });
});

describe("esteiraForContext — fail-open", () => {
  it("prefere a modalidade do template", () => {
    expect(
      esteiraForContext({ dealKind: "venda", templateModalidade: "locacao" })
    ).toBe("locacao");
  });

  it("sem NENHUM sinal, devolve null (não filtra)", () => {
    // lib/ai/shared/context.ts faz `contract.deal?.kind ?? "venda"`. Se aqui
    // assumíssemos venda, um contrato sem deal perderia todo o acervo de
    // locação em silêncio. Este teste existe pra impedir a "simplificação".
    expect(esteiraForContext({})).toBeNull();
    expect(esteiraForContext({ dealKind: null, templateModalidade: null })).toBeNull();
    expect(esteiraForContext({ dealKind: "  " })).toBeNull();
  });

  it("dealKind desconhecido não arrisca um palpite", () => {
    expect(esteiraForContext({ dealKind: "permuta" })).toBeNull();
  });

  it("usa dealKind quando é o único sinal", () => {
    expect(esteiraForContext({ dealKind: "locacao" })).toBe("locacao");
    expect(esteiraForContext({ dealKind: "VENDA" })).toBe("venda");
  });
});

describe("eixos por esteira", () => {
  it("venda agrupa por groupCode e locação por subcategory", () => {
    expect(axisFor("venda").kind).toBe("groupCode");
    expect(axisFor("locacao").kind).toBe("subcategory");
  });

  it("a regra do G4 é dita ao humano, não só ao prompt", () => {
    const g4 = ESTEIRA_AXIS.venda.groups.find((g) => g.code === "G4");
    expect(g4?.help).toMatch(/financiamento/i);
  });

  it("locação não usa códigos Gx", () => {
    for (const g of ESTEIRA_AXIS.locacao.groups) {
      expect(g.code).not.toMatch(/^G\d$/);
    }
  });

  it("os fixtures primários são modalidades válidas de preview", () => {
    for (const m of Object.values(ESTEIRA_PRIMARY_FIXTURE)) {
      expect(CLAUSE_PREVIEW_MODALIDADE_VALUES).toContain(m as never);
    }
  });
});

describe("groupCodeFor", () => {
  it("venda lê groupCode; locação lê subcategory", () => {
    expect(groupCodeFor("venda", { groupCode: "G1", subcategory: "sinal" })).toBe("G1");
    expect(groupCodeFor("locacao", { groupCode: null, subcategory: "vistoria" })).toBe(
      "vistoria"
    );
  });

  it("valor fora do eixo cai em 'sem grupo' (null), não some", () => {
    // O buraco antigo: uma cláusula fora da partição desaparecia das abas e
    // parecia deletada. Aqui ela vira bucket explícito.
    expect(groupCodeFor("locacao", { subcategory: "customizada" })).toBeNull();
    expect(groupCodeFor("venda", { groupCode: null })).toBeNull();
  });

  it("groupCode de venda não vaza para o eixo de locação", () => {
    expect(groupCodeFor("locacao", { groupCode: "G1", subcategory: null })).toBeNull();
  });
});

describe("visibleEsteiras", () => {
  it("sempre inclui 'ambas'", () => {
    expect(visibleEsteiras("venda")).toEqual(["venda", "ambas"]);
    expect(visibleEsteiras("locacao")).toEqual(["locacao", "ambas"]);
  });
});
