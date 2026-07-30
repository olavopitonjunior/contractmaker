import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    contractTemplate: { findMany: vi.fn() },
  },
}));

import {
  deriveCategoryFromPayment,
  resolveTemplateId,
  modalidadeForCategory,
  resolveTemplateTaxonomy,
  schemaTypeForModalidade,
  selectLocacaoTemplate,
  selectAdministracaoTemplate,
  templateFamilyForModalidade,
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
