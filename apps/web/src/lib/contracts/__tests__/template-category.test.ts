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
  selectLocacaoTemplate,
  selectAdministracaoTemplate,
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
