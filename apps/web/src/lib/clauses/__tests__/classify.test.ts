import { describe, it, expect } from "vitest";
import {
  buildProposal,
  diffSummary,
  type ClauseSnapshot,
  type ClassifyDeps,
  type RawClassification,
} from "@/lib/clauses/classify";

/** Deps determinísticas fáceis de controlar por teste. */
function deps(over: Partial<ClassifyDeps> = {}): ClassifyDeps {
  return {
    validateKey: () => "validada",
    applyMapping: (content, trecho, chave) =>
      content.includes(trecho)
        ? { ok: true, content: content.replace(trecho, `{{${chave}}}`) }
        : { ok: false, reason: "nao_encontrado" },
    assertRendered: () => ({ ok: true }),
    ...over,
  };
}

function clause(over: Partial<ClauseSnapshot> = {}): ClauseSnapshot {
  return {
    id: "cl1",
    title: "Cláusula de teste",
    content: "O locatário pagará multa de 3 aluguéis.",
    tags: [],
    source: "manual",
    esteira: null,
    groupCode: null,
    subcategory: null,
    agentNotes: null,
    isVariable: false,
    ...over,
  };
}

describe("esteira e grupo", () => {
  it("propõe esteira e aceita grupo em venda", () => {
    const p = buildProposal(
      clause(),
      { esteira: "venda", groupCode: "G1", subcategory: "sinal" },
      deps()
    );
    expect(p?.fields.esteira?.proposed).toBe("venda");
    expect(p?.fields.groupCode?.proposed).toBe("G1");
    expect(p?.fields.subcategory?.proposed).toBe("sinal");
  });

  it("DESCARTA groupCode fora de venda e avisa", () => {
    // G1..G6 é taxonomia de compra e venda; em locação é sempre erro.
    const p = buildProposal(
      clause(),
      { esteira: "locacao", groupCode: "G3", subcategory: "rescisao" },
      deps()
    );
    expect(p?.fields.groupCode).toBeUndefined();
    expect(p?.warnings.some((w) => w.kind === "grupo_descartado")).toBe(true);
  });

  it("limpa groupCode existente quando a cláusula vira locação", () => {
    const p = buildProposal(
      clause({ groupCode: "G3" }),
      { esteira: "locacao" },
      deps()
    );
    expect(p?.fields.groupCode).toEqual({ current: "G3", proposed: null });
  });

  it("ignora esteira inválida vinda do modelo", () => {
    const p = buildProposal(clause(), { esteira: "financiamento" }, deps());
    expect(p?.fields.esteira).toBeUndefined();
  });

  it("aceita tema do eixo de locação como subcategoria", () => {
    const p = buildProposal(
      clause(),
      { esteira: "locacao", subcategory: "vistoria" },
      deps()
    );
    expect(p?.fields.subcategory?.proposed).toBe("vistoria");
  });

  it("rejeita subcategoria inventada", () => {
    const p = buildProposal(
      clause(),
      { esteira: "locacao", subcategory: "coisa-inventada" },
      deps()
    );
    expect(p?.fields.subcategory).toBeUndefined();
  });
});

describe("tags — congelamento por origem", () => {
  it("NÃO altera tags de seed_curado, e avisa", () => {
    // Acrescentar já muda o conjunto exato e faz a reingestão duplicar.
    const p = buildProposal(
      clause({ source: "seed_curado", tags: ["slot:garantia", "garantia:caucao"] }),
      { esteira: "locacao", tags: ["tema:garantia"] },
      deps()
    );
    expect(p?.fields.tags).toBeUndefined();
    expect(p?.warnings.some((w) => w.kind === "tags_congeladas")).toBe(true);
  });

  it("NÃO altera tags de consolidacao_modelos", () => {
    const p = buildProposal(
      clause({ source: "consolidacao_modelos", tags: ["slot:garantia"] }),
      { tags: ["tema:garantia"] },
      deps()
    );
    expect(p?.fields.tags).toBeUndefined();
  });

  it("congela também por tag de identidade, mesmo com source manual", () => {
    const p = buildProposal(
      clause({ source: "manual", tags: ["provider:too"] }),
      { tags: ["tema:garantia"] },
      deps()
    );
    expect(p?.fields.tags).toBeUndefined();
  });

  it("acrescenta descritivas em cláusula manual comum", () => {
    const p = buildProposal(
      clause({ tags: ["locacao"] }),
      { esteira: "locacao", tags: ["tema:vistoria", "lei:8245-91"] },
      deps()
    );
    expect(p?.fields.tags?.proposed).toEqual(["locacao", "tema:vistoria", "lei:8245-91"]);
  });

  it("descarta tag de identidade proposta pelo modelo", () => {
    const p = buildProposal(
      clause(),
      { tags: ["slot:garantia", "provider:porto_seguro"] },
      deps()
    );
    expect(p?.fields.tags).toBeUndefined();
  });
});

describe("tokenização de chaves", () => {
  const raw: RawClassification = {
    esteira: "locacao",
    mappings: [{ trecho: "3", chave: "config.multa_rescisoria_meses" }],
  };

  it("aplica mapeamento válido e deriva isVariable", () => {
    const p = buildProposal(clause({ content: "multa de 3 aluguéis" }), raw, deps());
    expect(p?.fields.content?.proposed).toBe(
      "multa de {{config.multa_rescisoria_meses}} aluguéis"
    );
    expect(p?.fields.isVariable?.proposed).toBe(true);
  });

  it("descarta chave fora do catálogo", () => {
    const p = buildProposal(
      clause({ content: "multa de 3 aluguéis" }),
      raw,
      deps({ validateKey: () => "rejeitada" })
    );
    expect(p?.fields.content).toBeUndefined();
  });

  it("descarta trecho ambíguo", () => {
    const p = buildProposal(
      clause({ content: "3 meses e 3 dias" }),
      raw,
      deps({ applyMapping: () => ({ ok: false, reason: "ambiguo" }) })
    );
    expect(p?.fields.content).toBeUndefined();
  });

  it("chave condicional gera aviso mas passa", () => {
    const p = buildProposal(
      clause({ content: "multa de 3 aluguéis" }),
      raw,
      deps({ validateKey: () => "condicional" })
    );
    expect(p?.fields.content?.mappings[0].tier).toBe("condicional");
    expect(p?.warnings.some((w) => w.kind === "chave_condicional")).toBe(true);
  });

  it("render quebrado derruba a proposta de conteúdo, mas preserva metadados", () => {
    const p = buildProposal(
      clause({ content: "multa de 3 aluguéis" }),
      { ...raw, subcategory: "rescisao" },
      deps({ assertRendered: () => ({ ok: false, error: "boom" }) })
    );
    expect(p?.fields.content).toBeUndefined();
    expect(p?.fields.subcategory?.proposed).toBe("rescisao");
  });

  it("sem esteira resolvível, não tokeniza", () => {
    // Sem catálogo contra o que validar, tokenizar seria chute.
    const p = buildProposal(
      clause({ content: "multa de 3 aluguéis" }),
      { mappings: raw.mappings, subcategory: "rescisao" },
      deps()
    );
    expect(p?.fields.content).toBeUndefined();
  });

  it("avisa quando há contrato vinculado", () => {
    const p = buildProposal(
      clause({ content: "multa de 3 aluguéis", linkedContracts: 4 }),
      raw,
      deps()
    );
    expect(p?.warnings.some((w) => w.kind === "contratos_vinculados")).toBe(true);
  });
});

describe("PII e diff vazio", () => {
  it("avisa PII sem sanitizar", () => {
    const p = buildProposal(
      clause(),
      { esteira: "locacao" },
      deps({ detectPii: () => ["João da Silva"] })
    );
    expect(p?.warnings.some((w) => w.kind === "pii_detectada")).toBe(true);
    // O conteúdo NÃO é alterado por causa de PII — quem decide é o humano.
    expect(p?.fields.content).toBeUndefined();
  });

  it("devolve null quando nada mudaria", () => {
    const p = buildProposal(
      clause({ esteira: "locacao", subcategory: "vistoria" }),
      { esteira: "locacao", subcategory: "vistoria" },
      deps()
    );
    expect(p).toBeNull();
  });
});

describe("diffSummary", () => {
  it("resume os campos que mudam", () => {
    const p = buildProposal(
      clause({ content: "multa de 3 aluguéis" }),
      {
        esteira: "locacao",
        subcategory: "rescisao",
        tags: ["tema:rescisao"],
        agentNotes: "Use em locação residencial.",
        mappings: [{ trecho: "3", chave: "config.multa_rescisoria_meses" }],
      },
      deps()
    );
    const s = diffSummary(p!);
    expect(s).toContain("esteira");
    expect(s).toContain("tema");
    expect(s).toContain("notas do agente");
    expect(s.some((x) => x.includes("chave"))).toBe(true);
  });
});
