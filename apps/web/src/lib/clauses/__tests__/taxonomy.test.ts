import { describe, it, expect } from "vitest";
import {
  esteiraForModalidade,
  esteiraForContext,
  axisFor,
  groupCodeFor,
  visibleEsteiras,
  ESTEIRA_AXIS,
  ESTEIRA_PRIMARY_FIXTURE,
  isEsteiraConsistent,
  findEsteiraInconsistencies,
  groupCodeForEsteira,
  esteiraFromTags,
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
  it("usa a modalidade do template quando é o único sinal", () => {
    expect(esteiraForContext({ templateModalidade: "locacao" })).toBe("locacao");
    expect(esteiraForContext({ templateModalidade: "a_vista" })).toBe("venda");
  });

  it("sinais contraditórios NÃO filtram", () => {
    // Dado inconsistente. Não filtrar é recuperável; esconder o acervo errado
    // do agente é um bug silencioso e caríssimo de diagnosticar.
    expect(
      esteiraForContext({ dealKind: "venda", templateModalidade: "locacao" })
    ).toBeNull();
    expect(
      esteiraForContext({ dealKind: "locacao", templateModalidade: "a_vista" })
    ).toBeNull();
  });

  it("CONTRATO IMPORTADO de locação resolve como locação", () => {
    // A regressão que a revisão pegou: contrato importado não tem template, e
    // `buildAgentContext` defaulta `templateModalidade` para "a_vista". Se a
    // esteira fosse calculada a partir do valor JÁ defaultado, uma locação
    // importada viraria "venda" e o agente perderia todo o acervo de locação.
    // Com os valores CRUS (modalidade null), o dealKind decide.
    expect(
      esteiraForContext({ dealKind: "locacao", templateModalidade: null })
    ).toBe("locacao");
    expect(esteiraForContext({ dealKind: "venda", templateModalidade: null })).toBe(
      "venda"
    );
  });

  it("importado sem deal nenhum não filtra", () => {
    expect(esteiraForContext({ dealKind: null, templateModalidade: null })).toBeNull();
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

describe("invariante esteira × groupCode", () => {
  // As formas abaixo NÃO são inventadas: são as linhas que estavam em produção
  // em 02/09/2026, quando o backfill original mandou o acervo curado de garantia
  // da RE/MAX Trio e da RE/MAX Ativa para a esteira de venda.
  const CURADAS_DE_LOCACAO = [
    { title: "Garantia — Fiador", groupCode: "GARANTIA", tags: ["slot:garantia", "garantia:fiador"] },
    { title: "Garantia — Caução em dinheiro", groupCode: "GARANTIA", tags: ["slot:garantia", "garantia:caucao"] },
    { title: "Cláusula opcional — Comissão de co-corretagem", groupCode: "OPCIONAL", tags: ["locacao:opcional"] },
  ];

  it("groupCode fora de G1..G6 não pode conviver com esteira=venda", () => {
    for (const c of CURADAS_DE_LOCACAO) {
      expect(isEsteiraConsistent({ ...c, esteira: "venda" })).toBe(false);
    }
  });

  it("as mesmas linhas são consistentes em locação e em triagem", () => {
    // O conserto aceito é mudar a ESTEIRA, não o groupCode: 'GARANTIA' é o eixo
    // legítimo do acervo curado e a migration de correção não o toca.
    for (const c of CURADAS_DE_LOCACAO) {
      expect(isEsteiraConsistent({ ...c, esteira: "locacao" })).toBe(true);
      expect(isEsteiraConsistent({ ...c, esteira: null })).toBe(true);
    }
  });

  it("venda legítima passa: G1..G6, ou sem grupo nenhum", () => {
    expect(isEsteiraConsistent({ esteira: "venda", groupCode: "G4" })).toBe(true);
    expect(isEsteiraConsistent({ esteira: "venda", groupCode: null })).toBe(true);
    expect(isEsteiraConsistent({ esteira: "venda" })).toBe(true);
  });

  it("a guarda de escrita RECUSA gravar o estado incoerente", () => {
    // Afirmação de NEGAÇÃO: não basta o detector detectar depois. Estes são os
    // dois caminhos reais — aprovar só o campo `esteira` no classificador, e o
    // PATCH que não menciona `groupCode` — reduzidos ao que decidem.
    for (const c of CURADAS_DE_LOCACAO) {
      expect(groupCodeForEsteira("venda", c.groupCode)).toBeNull();
      expect(isEsteiraConsistent({ esteira: "venda", groupCode: groupCodeForEsteira("venda", c.groupCode) })).toBe(true);
    }
  });

  it("a guarda preserva o grupo legítimo e limpa Gx fora de venda", () => {
    expect(groupCodeForEsteira("venda", "G4")).toBe("G4");
    // Fora de venda o eixo é `subcategory`; um Gx pendurado não é exibido por
    // esteira nenhuma, então cai.
    expect(groupCodeForEsteira("locacao", "G4")).toBeNull();
    expect(groupCodeForEsteira("ambas", "G4")).toBeNull();
    expect(groupCodeForEsteira(null, "G4")).toBeNull();
    expect(groupCodeForEsteira("venda", null)).toBeNull();
  });

  it("a guarda PRESERVA a taxonomia do acervo curado fora de venda", () => {
    // Achado de review: apagar 'GARANTIA' aqui poria a guarda em contradição
    // com a própria migration de correção, que move a esteira e NUNCA o grupo.
    // O primeiro PATCH em qualquer das 37 linhas consertadas apagaria o eixo
    // do curador.
    expect(groupCodeForEsteira("locacao", "GARANTIA")).toBe("GARANTIA");
    expect(groupCodeForEsteira("locacao", "OPCIONAL")).toBe("OPCIONAL");
    expect(groupCodeForEsteira("ambas", "GARANTIA")).toBe("GARANTIA");
    expect(groupCodeForEsteira(null, "GARANTIA")).toBe("GARANTIA");
  });

  it("detector e guarda NUNCA divergem — são a mesma regra", () => {
    const esteiras = ["venda", "locacao", "ambas", null];
    const grupos = ["G1", "G4", "GARANTIA", "OPCIONAL", "none", null];
    for (const esteira of esteiras) {
      for (const groupCode of grupos) {
        const persistido = groupCodeForEsteira(esteira, groupCode);
        // O que a guarda grava é, por definição, o que o detector aprova.
        expect(isEsteiraConsistent({ esteira, groupCode: persistido })).toBe(true);
      }
    }
  });

  it("esteiraFromTags classifica na ORIGEM o que a migration consertou no destino", () => {
    // Estas são as tags reais das 14 curadas da Trio e das 4 de consolidação.
    expect(esteiraFromTags(["slot:garantia", "garantia:fiador"])).toBe("locacao");
    expect(esteiraFromTags(["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"])).toBe("locacao");
    expect(esteiraFromTags(["cobertura:pintura_externa"])).toBe("locacao");
    expect(esteiraFromTags(["locacao:opcional", "tema:co_corretagem"])).toBe("locacao");
    expect(esteiraFromTags(["locacao"])).toBe("locacao");
  });

  it("esteiraFromTags NÃO chuta sem evidência de identidade", () => {
    // Sem prefixo de identidade, devolve null — a fila de triagem, lida nas
    // duas esteiras. Chutar aqui seria repetir a premissa que furou o backfill.
    expect(esteiraFromTags(["tema:arras", "lei:cc-417"])).toBeNull();
    expect(esteiraFromTags([])).toBeNull();
    // `provider:` sozinho não basta: seguradora não é exclusividade de locação.
    expect(esteiraFromTags(["provider:porto_seguro"])).toBeNull();
  });

  it("findEsteiraInconsistencies separa as violações do acervo saudável", () => {
    const acervo = [
      { title: "Sinal e princípio de pagamento", esteira: "venda", groupCode: "G1" },
      { title: "Financiamento e registro", esteira: "venda", groupCode: "G4" },
      ...CURADAS_DE_LOCACAO.map((c) => ({ ...c, esteira: "venda" })),
      { title: "Vistoria de entrada", esteira: "locacao", groupCode: null },
    ];
    const ruins = findEsteiraInconsistencies(acervo);
    expect(ruins.map((c) => c.title)).toEqual(CURADAS_DE_LOCACAO.map((c) => c.title));
  });
});
