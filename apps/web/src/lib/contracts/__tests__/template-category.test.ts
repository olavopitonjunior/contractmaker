import { describe, it, expect } from "vitest";
import {
  deriveCategoryFromPayment,
  resolveTemplateId,
  modalidadeForCategory,
  type TemplateLite,
} from "../template-category";

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
