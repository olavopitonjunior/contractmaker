import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    contractTemplate: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

import {
  deriveCategory,
  deriveCategoryFromPayment,
  deriveTemplateFacts,
  eligibleModalidadesForDealKind,
  matchCriteriaSchema,
  matchCriteriaSummary,
  normalizeGarantiaTipo,
  parseMatchCriteria,
  resolveTemplateId,
  resolveTemplateOverride,
  modalidadeForCategory,
  modalidadeLabel,
  resolveTemplateTaxonomy,
  schemaTypeForModalidade,
  scoreTemplateAgainstFacts,
  selectLocacaoTemplate,
  selectAdministracaoTemplate,
  templateFamilyForModalidade,
  previewFixturesForModalidade,
  type TemplateLite,
} from "../template-category";
import { prisma } from "@/lib/db/prisma";

const mockFindMany = vi.mocked(prisma.contractTemplate.findMany);
const mockFindUnique = vi.mocked(prisma.contractTemplate.findUnique);

describe("deriveCategoryFromPayment", () => {
  it("classifica o caso do deal 20486 (sinal + financiamento + banco) como financiamento", () => {
    const dataJson = {
      pagamento: {
        banco_financiamento: "itau",
        parcelas: [{ tipo: "sinal_arras" }, { tipo: "financiamento" }],
      },
    };
    expect(deriveCategoryFromPayment(dataJson)).toBe("financiamento");
  });

  it("prioriza consórcio", () => {
    expect(
      deriveCategoryFromPayment({ pagamento: { parcelas: [{ tipo: "cessao_consorcio" }] } })
    ).toBe("consorcio");
  });

  it("financiamento vence FGTS quando ambos presentes", () => {
    expect(
      deriveCategoryFromPayment({
        pagamento: { parcelas: [{ tipo: "fgts" }, { tipo: "financiamento" }] },
      })
    ).toBe("financiamento");
  });

  it("FGTS isolado → fgts", () => {
    expect(deriveCategoryFromPayment({ pagamento: { parcelas: [{ tipo: "fgts" }] } })).toBe("fgts");
  });

  it("banco_financiamento sozinho já sinaliza financiamento", () => {
    expect(
      deriveCategoryFromPayment({ pagamento: { banco_financiamento: "bradesco", parcelas: [] } })
    ).toBe("financiamento");
  });

  it("permuta → permuta", () => {
    expect(
      deriveCategoryFromPayment({ pagamento: { parcelas: [{ tipo: "permuta_imovel" }] } })
    ).toBe("permuta");
  });

  it("outros → outros", () => {
    expect(deriveCategoryFromPayment({ pagamento: { parcelas: [{ tipo: "outros" }] } })).toBe(
      "outros"
    );
  });

  it("recursos próprios / vazio → compra_e_venda", () => {
    expect(
      deriveCategoryFromPayment({ pagamento: { parcelas: [{ tipo: "recursos_proprios" }] } })
    ).toBe("compra_e_venda");
    expect(deriveCategoryFromPayment({})).toBe("compra_e_venda");
    expect(deriveCategoryFromPayment(null)).toBe("compra_e_venda");
  });
});

describe("deriveCategory — escolha humana como prior sobre a heurística", () => {
  // Payloads que fazem a HEURÍSTICA devolver cada uma das 6 categorias.
  const PAYLOAD_BY_CATEGORY: Record<string, Record<string, unknown>> = {
    compra_e_venda: { pagamento: { parcelas: [{ tipo: "recursos_proprios" }] } },
    permuta: { pagamento: { parcelas: [{ tipo: "permuta_imovel" }] } },
    outros: { pagamento: { parcelas: [{ tipo: "outros" }] } },
    financiamento: { pagamento: { parcelas: [{ tipo: "financiamento" }] } },
    fgts: { pagamento: { parcelas: [{ tipo: "fgts" }] } },
    consorcio: { pagamento: { parcelas: [{ tipo: "cessao_consorcio" }] } },
  };

  // Tabela 6 categorias × 3 estados de modalidade (ausente | a_vista |
  // financiamento). Regras: ausente reproduz a heurística byte a byte;
  // a_vista NUNCA sobrescreve; financiamento só puxa quando a heurística caiu
  // no grupo SEM alienação (consórcio/fgts são do grupo com alienação e ficam).
  const TABLE: Array<[string, string | undefined, string]> = [
    ["compra_e_venda", undefined, "compra_e_venda"],
    ["compra_e_venda", "a_vista", "compra_e_venda"],
    ["compra_e_venda", "financiamento", "financiamento"],
    ["permuta", undefined, "permuta"],
    ["permuta", "a_vista", "permuta"],
    ["permuta", "financiamento", "financiamento"],
    ["outros", undefined, "outros"],
    ["outros", "a_vista", "outros"],
    ["outros", "financiamento", "financiamento"],
    ["financiamento", undefined, "financiamento"],
    ["financiamento", "a_vista", "financiamento"],
    ["financiamento", "financiamento", "financiamento"],
    ["fgts", undefined, "fgts"],
    ["fgts", "a_vista", "fgts"],
    ["fgts", "financiamento", "fgts"],
    ["consorcio", undefined, "consorcio"],
    ["consorcio", "a_vista", "consorcio"],
    ["consorcio", "financiamento", "consorcio"],
  ];

  it.each(TABLE)(
    "heurística %s + modalidade %s → %s",
    (heuristica, modalidade, esperado) => {
      const payload = {
        ...PAYLOAD_BY_CATEGORY[heuristica],
        ...(modalidade ? { modalidade } : {}),
      };
      // Sanidade: o payload realmente produz a categoria heurística declarada.
      expect(deriveCategoryFromPayment(payload)).toBe(heuristica);
      expect(deriveCategory(payload)).toBe(esperado);
    }
  );

  it("ausente/inválido reproduz a heurística (nulls inclusive)", () => {
    expect(deriveCategory(null)).toBe("compra_e_venda");
    expect(deriveCategory({})).toBe("compra_e_venda");
    expect(deriveCategory({ modalidade: "qualquer_coisa" })).toBe("compra_e_venda");
  });
});

describe("modalidadeForCategory", () => {
  it("mapeia categorias ao grupo/modalidade", () => {
    expect(modalidadeForCategory("compra_e_venda")).toBe("a_vista");
    expect(modalidadeForCategory("permuta")).toBe("a_vista");
    expect(modalidadeForCategory("financiamento")).toBe("financiamento");
    expect(modalidadeForCategory("consorcio")).toBe("financiamento");
  });
});

describe("resolveTemplateId", () => {
  const av: TemplateLite = { id: "av", category: "compra_e_venda", modalidade: "a_vista", isDefault: true, status: "active" };
  const fin: TemplateLite = { id: "fin", category: "financiamento", modalidade: "financiamento", isDefault: true, status: "active" };
  const base = [av, fin];

  it("match exato de categoria", () => {
    expect(resolveTemplateId("financiamento", base)).toBe("fin");
    expect(resolveTemplateId("compra_e_venda", base)).toBe("av");
  });

  it("consórcio sem template → principal do grupo com alienação (financiamento)", () => {
    expect(resolveTemplateId("consorcio", base)).toBe("fin");
    expect(resolveTemplateId("fgts", base)).toBe("fin");
  });

  it("permuta sem template → principal do grupo sem alienação (à vista)", () => {
    expect(resolveTemplateId("permuta", base)).toBe("av");
    expect(resolveTemplateId("outros", base)).toBe("av");
  });

  it("usa template específico da categoria quando existir", () => {
    const perm: TemplateLite = { id: "perm", category: "permuta", modalidade: "a_vista", isDefault: false, status: "active" };
    expect(resolveTemplateId("permuta", [...base, perm])).toBe("perm");
  });

  it("ignora arquivados", () => {
    const finArchived: TemplateLite = { ...fin, status: "archived" };
    // sem financiamento ativo → cai no default geral (av)
    expect(resolveTemplateId("financiamento", [av, finArchived])).toBe("av");
  });

  it("lista vazia → null", () => {
    expect(resolveTemplateId("financiamento", [])).toBeNull();
  });
});

describe("templateFamilyForModalidade", () => {
  it("classifica por modalidade", () => {
    expect(templateFamilyForModalidade("a_vista")).toBe("venda");
    expect(templateFamilyForModalidade("financiamento")).toBe("venda");
    expect(templateFamilyForModalidade(null)).toBe("venda");
    expect(templateFamilyForModalidade("locacao")).toBe("locacao");
    expect(templateFamilyForModalidade("locacao_comercial")).toBe("locacao");
    expect(templateFamilyForModalidade("administracao_locacao")).toBe("locacao");
    expect(templateFamilyForModalidade("proposta_locacao_residencial")).toBe("proposta");
  });
});

describe("resolveTemplateTaxonomy", () => {
  const locacao = { currentModalidade: "locacao", currentCategory: null };
  const venda = { currentModalidade: "a_vista", currentCategory: "compra_e_venda" };

  it("REGRESSÃO: categoria de venda não reclassifica template de locação", () => {
    // A tela de edição mandava `category` pra qualquer template; o servidor
    // derivava modalidade="a_vista" e o template sumia do selectLocacaoTemplate
    // ("Nenhum template de locação ativo").
    expect(resolveTemplateTaxonomy({ ...locacao, category: "outros" })).toEqual({
      category: null,
      modalidade: "locacao",
    });
    expect(resolveTemplateTaxonomy({ ...locacao, category: "financiamento" })).toEqual({
      category: null,
      modalidade: "locacao",
    });
  });

  it("locação troca de modalidade dentro da família", () => {
    expect(
      resolveTemplateTaxonomy({ ...locacao, modalidade: "locacao_comercial" })
    ).toEqual({ category: null, modalidade: "locacao_comercial" });
    expect(
      resolveTemplateTaxonomy({ ...locacao, modalidade: "administracao_locacao" })
    ).toEqual({ category: null, modalidade: "administracao_locacao" });
  });

  it("venda: categoria é canônica e deriva a modalidade do grupo", () => {
    expect(resolveTemplateTaxonomy({ ...venda, category: "consorcio" })).toEqual({
      category: "consorcio",
      modalidade: "financiamento",
    });
  });

  it("venda sem categoria no payload preserva o que já estava", () => {
    expect(resolveTemplateTaxonomy(venda)).toEqual({
      category: "compra_e_venda",
      modalidade: "a_vista",
    });
    // Ex.: PATCH { status: "archived" } vindo da listagem.
    expect(resolveTemplateTaxonomy({ ...venda, category: "lixo" })).toEqual({
      category: "compra_e_venda",
      modalidade: "a_vista",
    });
  });

  it("modalidade explícita conserta um template salvo na família errada", () => {
    // Foi o caso do "Com fiador" da RE/MAX Ativa (locação salva como a_vista).
    expect(
      resolveTemplateTaxonomy({
        currentModalidade: "a_vista",
        currentCategory: "outros",
        modalidade: "locacao",
      })
    ).toEqual({ category: null, modalidade: "locacao" });
  });

  it("ignora modalidade desconhecida", () => {
    expect(resolveTemplateTaxonomy({ ...locacao, modalidade: "chutando" })).toEqual({
      category: null,
      modalidade: "locacao",
    });
  });

  it("proposta não vira venda por categoria", () => {
    expect(
      resolveTemplateTaxonomy({
        currentModalidade: "proposta_venda",
        currentCategory: null,
        category: "compra_e_venda",
      })
    ).toEqual({ category: null, modalidade: "proposta_venda" });
  });
});

describe("schemaTypeForModalidade", () => {
  it("mapeia cada modalidade ao schema do instrumento", () => {
    expect(schemaTypeForModalidade("locacao")).toBe("locacao_residencial_v1");
    expect(schemaTypeForModalidade("locacao_comercial")).toBe("locacao_comercial_v1");
    expect(schemaTypeForModalidade("administracao_locacao")).toBe("administracao_locacao_v1");
    expect(schemaTypeForModalidade("a_vista")).toBe("compra_venda_v2");
    expect(schemaTypeForModalidade("proposta_venda")).toBe("compra_venda_v1");
    expect(schemaTypeForModalidade(null)).toBe("compra_venda_v2");
  });
});

describe("selectLocacaoTemplate × administracao_locacao", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tpl = (id: string, modalidade: string, isDefault = false) =>
    ({ id, modalidade, isDefault, status: "active" }) as never;

  it("fallback startsWith('locacao') NÃO pega o template de administração", async () => {
    // Org com APENAS o template de administração ativo: gerar a LOCAÇÃO deve
    // falhar (null) em vez de usar o instrumento errado.
    mockFindMany.mockResolvedValueOnce([tpl("adm", "administracao_locacao", true)]);
    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1");
    expect(result).toBeNull();
  });

  it("match exato de locação prefere isDefault e ignora administração", async () => {
    mockFindMany.mockResolvedValueOnce([
      tpl("adm", "administracao_locacao", true),
      tpl("loc-old", "locacao", false),
      tpl("loc-def", "locacao", true),
    ]);
    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1");
    expect(result?.template.id).toBe("loc-def");
  });
});

describe("deriveTemplateFacts", () => {
  it("lê garantia, fiador PF/PJ e natureza do locatário do form de locação", () => {
    expect(
      deriveTemplateFacts({
        garantia: { tipo: "fiador", fiador: { tipo_pessoa: "juridica", cnpj: "1" } },
        locatarios: [{ tipo_pessoa: "fisica", cpf: "1" }],
      })
    ).toEqual({
      garantia: "fiador",
      fiadorPessoa: "pj",
      pessoa: "pf",
      admImobiliaria: null,
    });
  });

  it("QUALQUER locatário jurídico torna o negócio PJ", () => {
    expect(
      deriveTemplateFacts({
        locatarios: [{ tipo_pessoa: "fisica" }, { tipo_pessoa: "juridica" }],
      }).pessoa
    ).toBe("pj");
  });

  it("fiador só conta quando a garantia É fiador", () => {
    // Rascunho que trocou pra caução mantendo o sub-objeto do fiador não pode
    // virar fato "tem fiador PJ".
    expect(
      deriveTemplateFacts({
        garantia: { tipo: "caucao", fiador: { tipo_pessoa: "juridica" } },
      }).fiadorPessoa
    ).toBeNull();
  });

  it("proposta: proponente é `compradores`; CPF/CNPJ salva quando não há tipo_pessoa", () => {
    expect(deriveTemplateFacts({ compradores: [{ nome: "X", cnpj: "12" }] }).pessoa).toBe("pj");
    expect(deriveTemplateFacts({ compradores: [{ nome: "X", cpf: "12" }] }).pessoa).toBe("pf");
  });

  it("dataJson pobre/ausente → tudo desconhecido (nunca desclassifica)", () => {
    const vazio = {
      garantia: null,
      fiadorPessoa: null,
      pessoa: null,
      admImobiliaria: null,
    };
    // Shape das propostas ANTIGAS (pré-página): partes só com nome.
    expect(deriveTemplateFacts({ locatarios: [{ nome: "Fulano" }] })).toEqual(vazio);
    expect(deriveTemplateFacts({})).toEqual(vazio);
    expect(deriveTemplateFacts(null)).toEqual(vazio);
    expect(deriveTemplateFacts({ garantia: { tipo: "chutando" } })).toEqual(vazio);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Rename `garantia_digital` → `garantia_onerosa` (decisão de produto,
// 2026-08-25). O rótulo antigo nomeava o FORNECEDOR, não a modalidade.
// ──────────────────────────────────────────────────────────────────────────
describe("normalizeGarantiaTipo (compat de leitura do rename)", () => {
  it("mapeia o legado, preserva o canônico e rejeita o resto", () => {
    expect(normalizeGarantiaTipo("garantia_digital")).toBe("garantia_onerosa");
    expect(normalizeGarantiaTipo("garantia_onerosa")).toBe("garantia_onerosa");
    expect(normalizeGarantiaTipo("fiador")).toBe("fiador");
    expect(normalizeGarantiaTipo("credpago")).toBeNull();
    expect(normalizeGarantiaTipo(undefined)).toBeNull();
    expect(normalizeGarantiaTipo(42)).toBeNull();
  });

  it("REGRESSÃO: deal LEGADO ainda pontua a variante de garantia onerosa", () => {
    // Sem o normalizador o fato viria `null`: o template marcado
    // `garantia: garantia_onerosa` empataria com o genérico e o operador
    // voltaria a trocar o modelo à mão.
    const legado = deriveTemplateFacts({
      garantia: { tipo: "garantia_digital", provider: "Almada" },
      locatarios: [{ tipo_pessoa: "fisica" }],
    });
    expect(legado.garantia).toBe("garantia_onerosa");
    expect(scoreTemplateAgainstFacts({ garantia: "garantia_onerosa" }, legado)).toBe(1);
    expect(scoreTemplateAgainstFacts({ garantia: "seguro_fianca" }, legado)).toBe(-1);
  });

  it("matchCriteria gravado com o valor legado continua casando", () => {
    expect(parseMatchCriteria({ garantia: "garantia_digital" })).toEqual({
      garantia: "garantia_onerosa",
    });
    expect(matchCriteriaSummary({ garantia: "garantia_digital" })).toEqual([
      "Garantia onerosa",
    ]);
    // E o schema da fronteira (tela de edição de modelo) aceita e canoniza.
    const parsed = matchCriteriaSchema.safeParse({ garantia: "garantia_digital" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data?.garantia).toBe("garantia_onerosa");
  });
});

describe("parseMatchCriteria / matchCriteriaSummary", () => {
  it("descarta chave e valor fora do enum; critério vazio vira null", () => {
    expect(parseMatchCriteria({ garantia: "fiador", lixo: "x", pessoa: "pj" })).toEqual({
      garantia: "fiador",
      pessoa: "pj",
    });
    expect(parseMatchCriteria({ garantia: "inexistente" })).toBeNull();
    expect(parseMatchCriteria({})).toBeNull();
    expect(parseMatchCriteria(null)).toBeNull();
    expect(parseMatchCriteria("fiador")).toBeNull();
  });

  it("resume os critérios pra badge", () => {
    expect(
      matchCriteriaSummary({ garantia: "fiador", fiadorPessoa: "pj", pessoa: "pf" })
    ).toEqual(["Fiador", "Fiador PJ", "Pessoa física"]);
    expect(matchCriteriaSummary(null)).toEqual([]);
  });

  it("admImobiliaria: `false` é preservado no parse e etiquetado na badge", () => {
    // Truthiness aqui apagaria o critério e a badge mentiria por omissão.
    expect(parseMatchCriteria({ admImobiliaria: false })).toEqual({
      admImobiliaria: false,
    });
    expect(parseMatchCriteria({ admImobiliaria: true })).toEqual({
      admImobiliaria: true,
    });
    expect(matchCriteriaSummary({ admImobiliaria: true })).toEqual(["Com administração"]);
    expect(matchCriteriaSummary({ admImobiliaria: false })).toEqual(["Sem administração"]);
    // String não vira critério no parse (a coerção é do schema, na fronteira).
    expect(parseMatchCriteria({ admImobiliaria: "false" })).toBeNull();
  });

  it("o schema coage o `false` que o <select> manda como string", () => {
    // Sem isso, "false" (string truthy) viraria `true` em algum boundary.
    expect(matchCriteriaSchema.parse({ admImobiliaria: "false" })).toEqual({
      admImobiliaria: false,
    });
    expect(matchCriteriaSchema.parse({ admImobiliaria: "true" })).toEqual({
      admImobiliaria: true,
    });
    expect(matchCriteriaSchema.parse({ admImobiliaria: true })).toEqual({
      admImobiliaria: true,
    });
    expect(() => matchCriteriaSchema.parse({ admImobiliaria: "talvez" })).toThrow();
    // `.strict()` segue valendo pro resto.
    expect(() => matchCriteriaSchema.parse({ chaveInventada: 1 })).toThrow();
  });
});

describe("scoreTemplateAgainstFacts", () => {
  const facts = deriveTemplateFacts({
    garantia: { tipo: "fiador", fiador: { tipo_pessoa: "juridica" } },
    locatarios: [{ tipo_pessoa: "fisica" }],
  });

  it("genérico pontua 0; cada campo que bate soma 1", () => {
    expect(scoreTemplateAgainstFacts(null, facts)).toBe(0);
    expect(scoreTemplateAgainstFacts({}, facts)).toBe(0);
    expect(scoreTemplateAgainstFacts({ garantia: "fiador" }, facts)).toBe(1);
    expect(
      scoreTemplateAgainstFacts({ garantia: "fiador", fiadorPessoa: "pj", pessoa: "pf" }, facts)
    ).toBe(3);
  });

  it("campo que contradiz fato conhecido desclassifica", () => {
    expect(scoreTemplateAgainstFacts({ garantia: "sem_garantia" }, facts)).toBe(-1);
    expect(scoreTemplateAgainstFacts({ pessoa: "pj" }, facts)).toBe(-1);
    // "PF com fiador PJ" × "PJ com fiador PJ": o eixo do fiador é independente.
    expect(scoreTemplateAgainstFacts({ fiadorPessoa: "pf" }, facts)).toBe(-1);
  });

  it("fato desconhecido não pontua nem desclassifica", () => {
    const cegos = deriveTemplateFacts({});
    expect(scoreTemplateAgainstFacts({ garantia: "fiador", pessoa: "pj" }, cegos)).toBe(0);
  });

  // ——— Eixo booleano: `false` é critério, não ausência de critério ———

  it("critério admImobiliaria:false PONTUA e DESCLASSIFICA como qualquer outro", () => {
    const semAdm = deriveTemplateFacts({ aluguel: { adm_imobiliaria: false } });
    const comAdm = deriveTemplateFacts({ aluguel: { adm_imobiliaria: true } });

    // Sob truthiness (`if (!wanted) continue`) este critério era ignorado e o
    // modelo de administração empatava com o comum em TODA locação.
    expect(scoreTemplateAgainstFacts({ admImobiliaria: false }, semAdm)).toBe(1);
    expect(scoreTemplateAgainstFacts({ admImobiliaria: false }, comAdm)).toBe(-1);
    expect(scoreTemplateAgainstFacts({ admImobiliaria: true }, comAdm)).toBe(1);
    expect(scoreTemplateAgainstFacts({ admImobiliaria: true }, semAdm)).toBe(-1);
  });

  it("form sem o campo de administração não desclassifica nenhum dos dois lados", () => {
    const antigo = deriveTemplateFacts({ locatarios: [{ tipo_pessoa: "fisica" }] });
    expect(scoreTemplateAgainstFacts({ admImobiliaria: true }, antigo)).toBe(0);
    expect(scoreTemplateAgainstFacts({ admImobiliaria: false }, antigo)).toBe(0);
  });
});

describe("selectLocacaoTemplate × matchCriteria (variantes do form)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tpl = (
    id: string,
    matchCriteria: unknown = null,
    isDefault = false,
    modalidade = "locacao"
  ) => ({ id, modalidade, isDefault, status: "active", matchCriteria }) as never;

  const generico = tpl("generico", null, true);
  const comFiadorPj = tpl("fiador-pj", { garantia: "fiador", fiadorPessoa: "pj" });
  const comFiador = tpl("fiador", { garantia: "fiador" });
  const semGarantiaPj = tpl("sem-garantia-pj", { garantia: "sem_garantia", pessoa: "pj" });

  const formFiadorPj = {
    garantia: { tipo: "fiador", fiador: { tipo_pessoa: "juridica" } },
    locatarios: [{ tipo_pessoa: "fisica" }],
  };

  it("caso RE/MAX Ativa: form PF com fiador PJ escolhe a variante mais específica", async () => {
    mockFindMany.mockResolvedValueOnce([generico, comFiador, comFiadorPj]);
    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1", formFiadorPj);
    // 2 critérios batendo > 1 critério batendo > genérico isDefault.
    expect(result?.template.id).toBe("fiador-pj");
  });

  it("form sem garantia não pega o template de fiador (desclassificado)", async () => {
    mockFindMany.mockResolvedValueOnce([generico, comFiador, comFiadorPj]);
    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1", {
      garantia: { tipo: "sem_garantia" },
      locatarios: [{ tipo_pessoa: "fisica" }],
    });
    expect(result?.template.id).toBe("generico");
  });

  it("PJ sem garantia bate a variante por pessoa", async () => {
    mockFindMany.mockResolvedValueOnce([generico, semGarantiaPj, comFiador]);
    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1", {
      garantia: { tipo: "sem_garantia" },
      locatarios: [{ tipo_pessoa: "juridica" }],
    });
    expect(result?.template.id).toBe("sem-garantia-pj");
  });

  it("REGRESSÃO: org sem nenhum matchCriteria mantém o comportamento antigo", async () => {
    mockFindMany.mockResolvedValueOnce([
      tpl("loc-old", null, false),
      tpl("loc-def", null, true),
    ]);
    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1", formFiadorPj);
    expect(result?.template.id).toBe("loc-def");
  });

  it("sem dataJson (fatos nulos) nenhuma variante é descartada — vence o isDefault", async () => {
    mockFindMany.mockResolvedValueOnce([comFiador, generico, comFiadorPj]);
    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1");
    expect(result?.template.id).toBe("generico");
  });

  it("todos desclassificados → cai no comportamento pré-critério, não em erro", async () => {
    // Org só com variantes de fiador e um form de caução: gerar um contrato com
    // o padrão é melhor que estourar "nenhum template de locação ativo".
    mockFindMany.mockResolvedValueOnce([comFiadorPj, tpl("fiador-def", { garantia: "fiador" }, true)]);
    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1", {
      garantia: { tipo: "caucao" },
    });
    expect(result?.template.id).toBe("fiador-def");
  });

  it("caso RE/MAX Trio: o form escolhe sozinho entre o modelo comum e o de Administração", async () => {
    // Os dois modelos são da mesma modalidade e o operador escolhia à mão.
    const comum = tpl("trio-comum", { admImobiliaria: false }, true);
    const administracao = tpl("trio-adm", { admImobiliaria: true });
    const semDeal = { locatarios: [{ tipo_pessoa: "fisica" }] };

    mockFindMany.mockResolvedValueOnce([comum, administracao]);
    expect(
      (
        await selectLocacaoTemplate("org-1", "locacao_residencial_v1", {
          ...semDeal,
          aluguel: { adm_imobiliaria: true },
        })
      )?.template.id
    ).toBe("trio-adm");

    mockFindMany.mockResolvedValueOnce([comum, administracao]);
    expect(
      (
        await selectLocacaoTemplate("org-1", "locacao_residencial_v1", {
          ...semDeal,
          aluguel: { adm_imobiliaria: false },
        })
      )?.template.id
    ).toBe("trio-comum");

    // Deal antigo, sem o campo: ninguém é desclassificado, vence o isDefault.
    mockFindMany.mockResolvedValueOnce([comum, administracao]);
    expect(
      (await selectLocacaoTemplate("org-1", "locacao_residencial_v1", semDeal))?.template.id
    ).toBe("trio-comum");
  });

  it("o critério também desempata no fallback startsWith('locacao')", async () => {
    // Nenhum template da modalidade comercial: cai nos residenciais e ainda
    // assim respeita a variante.
    mockFindMany.mockResolvedValueOnce([generico, comFiadorPj]);
    const result = await selectLocacaoTemplate("org-1", "locacao_comercial_v1", formFiadorPj);
    expect(result?.template.id).toBe("fiador-pj");
  });
});

describe("selectAdministracaoTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tpl = (id: string, isDefault = false) =>
    ({ id, modalidade: "administracao_locacao", isDefault, status: "active" }) as never;

  it("match exato preferindo isDefault", async () => {
    mockFindMany.mockResolvedValueOnce([tpl("adm-b"), tpl("adm-a", true)]);
    const result = await selectAdministracaoTemplate("org-1");
    expect(result?.template.id).toBe("adm-a");
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", status: "active", modalidade: "administracao_locacao" },
    });
  });

  it("sem template da modalidade → null (SEM fallback pra locação)", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const result = await selectAdministracaoTemplate("org-1");
    expect(result).toBeNull();
  });
});

describe("modalidade temporada (short stay)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("é família locação e tem rótulo e schemaType próprios", () => {
    expect(templateFamilyForModalidade("temporada")).toBe("locacao");
    expect(modalidadeLabel("temporada")).toBe("Locação por temporada");
    // Reusa o schema residencial: sem form próprio, não há o que derivar.
    expect(schemaTypeForModalidade("temporada")).toBe("locacao_residencial_v1");
  });

  it("NUNCA é servida ao pareamento automático de uma locação comum", async () => {
    // O nome sem prefixo "locacao" é o que a mantém fora do fallback
    // `startsWith("locacao")`. Se alguém renomear pra `locacao_temporada`, este
    // teste cai — e é pra cair: seria servida por acidente a todo contrato de
    // locação de uma org que não tenha outro modelo ativo.
    mockFindMany.mockResolvedValueOnce([
      { id: "short-stay", modalidade: "temporada", isDefault: true, status: "active", matchCriteria: null },
    ] as never);

    const result = await selectLocacaoTemplate("org-1", "locacao_residencial_v1", {
      locatarios: [{ tipo_pessoa: "fisica" }],
    });

    expect(result).toBeNull();
  });

  it("é elegível pra ESCOLHA MANUAL num deal de locação", async () => {
    // O caminho pelo qual ela é de fato usada.
    expect(eligibleModalidadesForDealKind("locacao")).toContain("temporada");

    mockFindUnique.mockResolvedValueOnce({
      id: "short-stay",
      orgId: "org-1",
      status: "active",
      modalidade: "temporada",
    } as never);
    const r = await resolveTemplateOverride({
      templateId: "short-stay",
      orgId: "org-1",
      dealKind: "locacao",
    });
    expect(r.ok).toBe(true);
  });
});

describe("escolha manual de modelo (override)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locação NÃO oferece o contrato de administração", () => {
    const elegiveis = eligibleModalidadesForDealKind("locacao");
    expect(elegiveis).toContain("locacao");
    expect(elegiveis).toContain("locacao_comercial");
    // É outro INSTRUMENTO (imobiliária↔proprietário), apesar de família
    // "locacao": gerar o contrato do inquilino com ele produziria um documento
    // que não vincula quem assina.
    expect(elegiveis).not.toContain("administracao_locacao");
  });

  it("venda oferece só as modalidades de venda", () => {
    expect(eligibleModalidadesForDealKind("venda")).toEqual([
      "a_vista",
      "financiamento",
    ]);
  });

  const tplRow = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    orgId: "org-1",
    status: "active",
    modalidade: "locacao",
    ...over,
  });

  it("aceita o modelo válido da própria org", async () => {
    mockFindUnique.mockResolvedValueOnce(tplRow() as never);
    const r = await resolveTemplateOverride({
      templateId: "t1",
      orgId: "org-1",
      dealKind: "locacao",
    });
    expect(r.ok).toBe(true);
  });

  it("recusa template de outra org, arquivado, inexistente e de kind errado", async () => {
    mockFindUnique.mockResolvedValueOnce(tplRow({ orgId: "outra" }) as never);
    expect(
      await resolveTemplateOverride({ templateId: "t1", orgId: "org-1", dealKind: "locacao" })
    ).toEqual({ ok: false, reason: "cross-org" });

    mockFindUnique.mockResolvedValueOnce(tplRow({ status: "archived" }) as never);
    expect(
      await resolveTemplateOverride({ templateId: "t1", orgId: "org-1", dealKind: "locacao" })
    ).toEqual({ ok: false, reason: "archived" });

    // Rascunho é motivo PRÓPRIO: o modelo está listado em Ativos, ainda em
    // revisão. Chamá-lo de "arquivado" mandava o operador procurar na aba errada.
    mockFindUnique.mockResolvedValueOnce(tplRow({ status: "draft" }) as never);
    expect(
      await resolveTemplateOverride({ templateId: "t1", orgId: "org-1", dealKind: "locacao" })
    ).toEqual({ ok: false, reason: "draft" });

    mockFindUnique.mockResolvedValueOnce(null as never);
    expect(
      await resolveTemplateOverride({ templateId: "t1", orgId: "org-1", dealKind: "locacao" })
    ).toEqual({ ok: false, reason: "not-found" });

    // Modelo de VENDA num deal de locação.
    mockFindUnique.mockResolvedValueOnce(tplRow({ modalidade: "a_vista" }) as never);
    expect(
      await resolveTemplateOverride({ templateId: "t1", orgId: "org-1", dealKind: "locacao" })
    ).toEqual({ ok: false, reason: "wrong-kind" });
  });

  it("REGRESSÃO: o contrato de administração é recusado como modelo de um deal de locação", async () => {
    mockFindUnique.mockResolvedValueOnce(
      tplRow({ modalidade: "administracao_locacao" }) as never
    );
    expect(
      await resolveTemplateOverride({ templateId: "t1", orgId: "org-1", dealKind: "locacao" })
    ).toEqual({ ok: false, reason: "wrong-kind" });
  });
});

describe("previewFixturesForModalidade", () => {
  it("venda oferece as duas amostras do grupo, rotuladas", () => {
    const fixtures = previewFixturesForModalidade("a_vista");
    expect(fixtures.map((f) => f.value)).toEqual(["a_vista", "financiamento"]);
    expect(fixtures.map((f) => f.label)).toEqual([
      "Venda à vista",
      "Venda com financiamento",
    ]);
    // A modalidade do template não muda a lista — o grupo é o mesmo.
    expect(previewFixturesForModalidade("financiamento")).toEqual(fixtures);
  });

  it("locação, administração e proposta têm UMA amostra (a própria)", () => {
    // O diálogo mostrava "À Vista | Financiamento" hardcoded pra qualquer
    // template handlebars — inclusive proposta, cujo schema é outro.
    for (const m of [
      "locacao",
      "locacao_comercial",
      "administracao_locacao",
      "proposta_venda",
      "proposta_locacao_residencial",
      "proposta_locacao_comercial",
    ]) {
      const fixtures = previewFixturesForModalidade(m);
      expect(fixtures).toHaveLength(1);
      expect(fixtures[0].value).toBe(m);
      expect(fixtures[0].label).not.toBe(m); // tem rótulo legível
    }
  });

  it("modalidade nula cai no grupo de venda (template legado)", () => {
    expect(previewFixturesForModalidade(null).map((f) => f.value)).toEqual([
      "a_vista",
      "financiamento",
    ]);
  });
});
