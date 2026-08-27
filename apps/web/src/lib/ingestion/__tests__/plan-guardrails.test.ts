import { describe, it, expect } from "vitest";
import {
  MIN_SLOT_BLOCK_CHARS,
  validateLibraryPlan,
  type PlanGuardItem,
  type PlanViolationKind,
} from "@/lib/ingestion/plan-guardrails";
import {
  LIBRARY_PLAN_VERSION,
  type LibraryPlan,
  type PlannedClause,
  type PlannedTemplate,
} from "@/lib/ingestion/library-plan";
import { MIN_SLOT_BLOCK_CHARS as SERVER_MIN } from "@/lib/templates/apply-clause-slot";

/** Parágrafo de garantia com folga sobre o mínimo, presente no doc fonte. */
const GARANTIA_BLOCK =
  "Cláusula décima quinta: O seguro de Fiança Locatícia contratado pelo LOCADOR " +
  "junto à seguradora garantirá esta locação, nos termos do inciso III do artigo 37.";

const DOC_TEXT = [
  "CONTRATO DE LOCAÇÃO PARA FINS RESIDENCIAIS",
  "Cláusula primeira: o LOCADOR dá em locação ao LOCATÁRIO o imóvel descrito.",
  GARANTIA_BLOCK,
  "E por estarem assim justos e contratados, firmam o presente em duas vias.",
].join("\n");

function items(overrides: Partial<PlanGuardItem>[] = []): PlanGuardItem[] {
  const base: PlanGuardItem[] = [
    {
      id: "item-locacao",
      filename: "01-RES-PORTO.docx",
      text: DOC_TEXT,
      status: "classified",
      modalidade: "locacao",
    },
    {
      id: "item-venda",
      filename: "02-CCV.docx",
      text: "CONTRATO DE COMPRA E VENDA\nCláusula primeira: o VENDEDOR vende ao COMPRADOR.",
      status: "classified",
      modalidade: "a_vista",
    },
  ];
  return base.map((b, i) => ({ ...b, ...(overrides[i] ?? {}) }));
}

function template(over: Partial<PlannedTemplate> = {}): PlannedTemplate {
  return {
    sourceItemId: "item-locacao",
    name: "Locação residencial — seguro-fiança",
    modalidade: "locacao",
    matchCriteria: { garantia: "seguro_fianca" },
    rationale: "Única minuta do lote com apólice de fiança locatícia.",
    ...over,
  };
}

function clause(over: Partial<PlannedClause> = {}): PlannedClause {
  const provider = over.provider !== undefined ? over.provider : "Porto Seguro";
  const value = over.value ?? "seguro_fianca";
  return {
    slot: "garantia",
    value,
    provider,
    title: "Seguro-fiança — Porto Seguro",
    content: "O seguro de fiança locatícia garantirá esta locação nos termos da lei.",
    sourceItemId: "item-locacao",
    tags: [
      "slot:garantia",
      `garantia:${value}`,
      ...(provider ? ["provider:porto_seguro"] : []),
    ],
    rationale: "Variante do fornecedor.",
    ...over,
  };
}

function plan(over: Partial<LibraryPlan> = {}): LibraryPlan {
  return {
    version: LIBRARY_PLAN_VERSION,
    templates: [template()],
    clauses: [clause()],
    discards: [],
    issues: [],
    confidence: 0.9,
    ...over,
  };
}

function kinds(result: { violations: Array<{ kind: PlanViolationKind }> }): PlanViolationKind[] {
  return result.violations.map((v) => v.kind);
}

describe("guardrails — o plano feliz passa", () => {
  it("plano coerente não produz violação", () => {
    const result = validateLibraryPlan({ plan: plan(), items: items() });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("o mínimo do bloco de slot é o MESMO do servidor", () => {
    // Espelho: oferecer aqui um bloco que `applyClauseSlotToDoc` recusaria por
    // `too-short` só produziria uma falha anunciada mais tarde.
    expect(MIN_SLOT_BLOCK_CHARS).toBe(SERVER_MIN);
  });
});

describe("guardrails — integridade referencial", () => {
  it("template que aponta para item inexistente é rejeitado", () => {
    const result = validateLibraryPlan({
      plan: plan({ templates: [template({ sourceItemId: "item-fantasma" })] }),
      items: items(),
    });
    expect(result.ok).toBe(false);
    expect(kinds(result)).toContain("unknown_source_item");
    expect(result.violations[0].itemId).toBe("item-fantasma");
  });

  it("cláusula que aponta para item inexistente é rejeitada", () => {
    const result = validateLibraryPlan({
      plan: plan({ clauses: [clause({ sourceItemId: "nada" })] }),
      items: items(),
    });
    expect(kinds(result)).toContain("unknown_source_item");
  });

  it("descarte de item inexistente é rejeitado", () => {
    const result = validateLibraryPlan({
      plan: plan({
        discards: [{ itemId: "nada", reason: "duplicate", detail: "x" }],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("unknown_source_item");
  });

  it("template não pode nascer de um item que o próprio plano descartou", () => {
    const result = validateLibraryPlan({
      plan: plan({
        discards: [
          { itemId: "item-locacao", reason: "filled_instance", detail: "preenchido" },
        ],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("discarded_source_item");
  });

  it("template não pode nascer de item já descartado no run", () => {
    const result = validateLibraryPlan({
      plan: plan(),
      items: items([{ status: "discarded" }]),
    });
    expect(kinds(result)).toContain("discarded_source_item");
  });

  it("versão desconhecida para tudo — nem adianta olhar o resto", () => {
    const result = validateLibraryPlan({
      plan: { ...plan(), version: 99 as unknown as typeof LIBRARY_PLAN_VERSION },
      items: items(),
    });
    expect(result.ok).toBe(false);
    expect(kinds(result)).toEqual(["version_mismatch"]);
  });
});

describe("guardrails — valores canônicos e as regras de produto", () => {
  it("locação SEM matchCriteria.garantia é rejeitada", () => {
    const result = validateLibraryPlan({
      plan: plan({ templates: [template({ matchCriteria: {} })] }),
      items: items(),
    });
    expect(kinds(result)).toContain("missing_garantia_criteria");
  });

  it("venda não precisa de garantia — a regra é da locação", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [
          template({
            sourceItemId: "item-venda",
            modalidade: "a_vista",
            matchCriteria: {},
            name: "CCV à vista",
          }),
        ],
        clauses: [],
      }),
      items: items(),
    });
    expect(result.ok).toBe(true);
  });

  it("modalidade fora da taxonomia é rejeitada", () => {
    const result = validateLibraryPlan({
      plan: plan({ templates: [template({ modalidade: "locacao_rural" })] }),
      items: items(),
    });
    expect(kinds(result)).toContain("invalid_modalidade");
  });

  it("garantia fora da taxonomia é rejeitada no template e na cláusula", () => {
    const noTemplate = validateLibraryPlan({
      plan: plan({
        templates: [
          template({
            matchCriteria: {
              garantia: "fianca_bancaria" as never,
            },
          }),
        ],
      }),
      items: items(),
    });
    expect(kinds(noTemplate)).toContain("invalid_garantia");

    const noClause = validateLibraryPlan({
      plan: plan({
        clauses: [
          clause({
            value: "fianca_bancaria",
            tags: ["slot:garantia", "garantia:fianca_bancaria", "provider:porto_seguro"],
          }),
        ],
      }),
      items: items(),
    });
    expect(kinds(noClause)).toContain("invalid_garantia");
  });

  it("o valor LEGADO garantia_digital ainda é aceito — quem normaliza é o domínio", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [
          template({ matchCriteria: { garantia: "garantia_digital" as never } }),
        ],
        clauses: [],
      }),
      items: items(),
    });
    expect(kinds(result)).not.toContain("invalid_garantia");
  });

  it("eixo de matchCriteria que não existe na família é rejeitado", () => {
    // `admImobiliaria` só existe no CONTRATO de locação; na proposta o dado
    // nem foi coletado e marcá-lo desclassificaria o modelo.
    const result = validateLibraryPlan({
      plan: plan({
        templates: [
          template({
            modalidade: "proposta_locacao_residencial",
            matchCriteria: { garantia: "seguro_fianca", admImobiliaria: true },
          }),
        ],
        clauses: [],
      }),
      items: items([{ modalidade: "proposta_locacao_residencial" }]),
    });
    expect(kinds(result)).toContain("criteria_axis_not_applicable");
  });

  it("no máximo um principal sugerido por modalidade", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [
          template({ isDefaultSuggested: true }),
          template({
            name: "Locação residencial — fiador",
            matchCriteria: { garantia: "fiador" },
            isDefaultSuggested: true,
          }),
        ],
        clauses: [],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("multiple_defaults");
  });

  it("dois principais em MODALIDADES diferentes é legítimo", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [
          template({ isDefaultSuggested: true }),
          template({
            sourceItemId: "item-venda",
            modalidade: "a_vista",
            name: "CCV",
            matchCriteria: {},
            isDefaultSuggested: true,
          }),
        ],
        clauses: [],
      }),
      items: items(),
    });
    expect(kinds(result)).not.toContain("multiple_defaults");
  });
});

describe("guardrails — blocos de slot", () => {
  it("aceita o parágrafo que existe, literalmente, no documento fonte", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [template({ slotBlocks: { garantia: [GARANTIA_BLOCK] } })],
      }),
      items: items(),
    });
    expect(result.ok).toBe(true);
  });

  it("parágrafo que não está no documento fonte é rejeitado", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [
          template({
            slotBlocks: {
              garantia: [
                "Cláusula inventada pelo modelo que não existe em documento nenhum deste lote.",
              ],
            },
          }),
        ],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("slot_block_not_found");
  });

  it("parágrafo curto demais é rejeitado antes de chegar ao Google Docs", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [template({ slotBlocks: { garantia: ["Parágrafo único."] } })],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("slot_block_too_short");
  });

  it("slot que a família não tem é rejeitado", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [
          template({
            sourceItemId: "item-venda",
            modalidade: "a_vista",
            matchCriteria: {},
            slotBlocks: { garantia: [GARANTIA_BLOCK] },
          }),
        ],
        clauses: [],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("slot_not_applicable");
  });

  it("cláusula de slot para um item de venda é rejeitada", () => {
    const result = validateLibraryPlan({
      plan: plan({
        templates: [],
        clauses: [clause({ sourceItemId: "item-venda" })],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("slot_not_applicable");
  });
});

describe("guardrails — tags da cláusula", () => {
  it("conjunto de tags tem de ser EXATO", () => {
    const faltando = validateLibraryPlan({
      plan: plan({ clauses: [clause({ tags: ["slot:garantia", "garantia:seguro_fianca"] })] }),
      items: items(),
    });
    expect(kinds(faltando)).toContain("clause_tags_mismatch");

    const sobrando = validateLibraryPlan({
      plan: plan({
        clauses: [
          clause({
            tags: [
              "slot:garantia",
              "garantia:seguro_fianca",
              "provider:porto_seguro",
              "cobertura:danos",
            ],
          }),
        ],
      }),
      items: items(),
    });
    expect(kinds(sobrando)).toContain("clause_tags_mismatch");
  });

  it("a ordem das tags não importa — o que importa é o CONJUNTO", () => {
    const result = validateLibraryPlan({
      plan: plan({
        clauses: [
          clause({
            tags: ["provider:porto_seguro", "garantia:seguro_fianca", "slot:garantia"],
          }),
        ],
      }),
      items: items(),
    });
    expect(result.ok).toBe(true);
  });

  it("duas cláusulas com o MESMO conjunto de tags são rejeitadas", () => {
    // É o 422 que a triagem já previne no client: mesmo tipo de garantia e
    // mesmo garantidor são a MESMA cláusula do acervo.
    const result = validateLibraryPlan({
      plan: plan({
        clauses: [clause(), clause({ title: "Outra redação da Porto" })],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("duplicate_clause_tags");
  });

  it("fornecedores diferentes na mesma garantia convivem", () => {
    const result = validateLibraryPlan({
      plan: plan({
        clauses: [
          clause(),
          clause({
            provider: "Tokio Marine",
            title: "Seguro-fiança — Tokio Marine",
            tags: ["slot:garantia", "garantia:seguro_fianca", "provider:tokio_marine"],
          }),
        ],
      }),
      items: items(),
    });
    expect(result.ok).toBe(true);
  });

  it("cláusula genérica (sem fornecedor) não leva tag de provider", () => {
    const result = validateLibraryPlan({
      plan: plan({
        clauses: [
          clause({
            provider: null,
            tags: ["slot:garantia", "garantia:seguro_fianca"],
          }),
        ],
      }),
      items: items(),
    });
    expect(result.ok).toBe(true);
  });
});

describe("guardrails — PII na cláusula", () => {
  it("cláusula com CPF é rejeitada: embedding é irreversível", () => {
    const result = validateLibraryPlan({
      plan: plan({
        clauses: [
          clause({
            content:
              "Assina como fiador PEDRO TESTE, inscrito no CPF sob nº. 111.222.333-96.",
          }),
        ],
      }),
      items: items(),
    });
    expect(kinds(result)).toContain("clause_pii");
  });

  it("cláusula já sanitizada passa — o placeholder não reacusa", () => {
    const result = validateLibraryPlan({
      plan: plan({
        clauses: [
          clause({
            content:
              "Assina como fiador [NOME], inscrito no CPF sob nº. 000.000.000-00.",
          }),
        ],
      }),
      items: items(),
    });
    expect(result.ok).toBe(true);
  });

  it("cláusula sem texto é rejeitada", () => {
    const result = validateLibraryPlan({
      plan: plan({ clauses: [clause({ content: "   " })] }),
      items: items(),
    });
    expect(kinds(result)).toContain("empty_clause_content");
  });
});

describe("guardrails — colisão com a biblioteca existente", () => {
  const library = {
    templates: [
      {
        name: "Contrato de Locação Residencial — Seguro-Fiança",
        modalidade: "locacao",
        matchCriteria: { garantia: "seguro_fianca" as const },
      },
    ],
  };

  it("template com o MESMO modalidade×critério de um existente é rejeitado", () => {
    // O defeito real do lote de staging: os pares "(2)" nasceram porque o
    // planner não conhecia a biblioteca. `pickTemplateByFacts` não tem como
    // escolher entre dois candidatos com o mesmo critério.
    const result = validateLibraryPlan({ plan: plan(), items: items(), library });
    expect(kinds(result)).toContain("library_collision");
  });

  it("critério DIFERENTE do existente passa", () => {
    const p = plan({
      templates: [template({ matchCriteria: { garantia: "fiador" } })],
      clauses: [clause({ value: "fiador", provider: null, tags: ["slot:garantia", "garantia:fiador"], title: "Fiador" })],
    });
    const result = validateLibraryPlan({ plan: p, items: items(), library });
    expect(kinds(result)).not.toContain("library_collision");
  });

  it("sem a biblioteca no input, valida como antes (compat)", () => {
    const result = validateLibraryPlan({ plan: plan(), items: items() });
    expect(result.ok).toBe(true);
  });

  it("dois templates do PRÓPRIO plano com o mesmo critério também colidem", () => {
    const p = plan({
      templates: [
        template({ name: "A" }),
        template({ name: "B", sourceItemId: "item-venda", modalidade: "locacao" }),
      ],
    });
    const result = validateLibraryPlan({ plan: p, items: items() });
    expect(kinds(result)).toContain("library_collision");
  });

  it("critério VAZIO não disputa escolha — administração convive com drafts", () => {
    // O resolver de administração ignora matchCriteria; quem decide é o
    // isDefault, e `multiple_defaults` já vigia esse. Barrar aqui impediria o
    // par legítimo com/sem garantia de recebimento do acervo da Ativa.
    const p = plan({
      templates: [
        template({
          name: "Administração — Com Garantia",
          modalidade: "administracao_locacao",
          matchCriteria: {},
        }),
        template({
          name: "Administração — Sem Garantia",
          sourceItemId: "item-venda",
          modalidade: "administracao_locacao",
          matchCriteria: {},
        }),
      ],
      clauses: [],
    });
    const result = validateLibraryPlan({ plan: p, items: items() });
    expect(kinds(result)).not.toContain("library_collision");
  });

  it("descarte already_covered é aceito como razão válida", () => {
    const p = plan({
      templates: [],
      clauses: [],
      discards: [
        {
          itemId: "item-locacao",
          reason: "already_covered",
          detail: "Já coberto pelo modelo existente de seguro-fiança.",
        },
      ],
    });
    const result = validateLibraryPlan({ plan: p, items: items(), library });
    expect(result.ok).toBe(true);
  });
});

