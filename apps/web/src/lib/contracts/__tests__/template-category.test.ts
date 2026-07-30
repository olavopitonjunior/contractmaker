import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    contractTemplate: { findMany: vi.fn() },
  },
}));

import {
  deriveCategoryFromPayment,
  deriveTemplateFacts,
  matchCriteriaSummary,
  parseMatchCriteria,
  resolveTemplateId,
  modalidadeForCategory,
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
    ).toEqual({ garantia: "fiador", fiadorPessoa: "pj", pessoa: "pf" });
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
    const vazio = { garantia: null, fiadorPessoa: null, pessoa: null };
    // Shape das propostas ANTIGAS (pré-página): partes só com nome.
    expect(deriveTemplateFacts({ locatarios: [{ nome: "Fulano" }] })).toEqual(vazio);
    expect(deriveTemplateFacts({})).toEqual(vazio);
    expect(deriveTemplateFacts(null)).toEqual(vazio);
    expect(deriveTemplateFacts({ garantia: { tipo: "chutando" } })).toEqual(vazio);
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
