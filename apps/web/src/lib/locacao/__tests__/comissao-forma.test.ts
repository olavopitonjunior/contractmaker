import { describe, expect, it } from "vitest";
import { formaTaxaLocacao, taxaLocacaoEfetiva } from "../commission";
import { comissaoLocacaoSchema } from "@/lib/forms/validation-locacao";
import {
  DEFAULT_LOCACAO_COMISSAO,
  resolveOrgLocacaoComissao,
} from "@/lib/contracts/default-config";

/**
 * A taxa da imobiliária só existia em percentual — o angariador já tinha as
 * duas formas. Uma imobiliária que cobra "R$ 800 pela intermediação" não tinha
 * onde dizer isso.
 */
describe("comissaoLocacaoSchema — forma da taxa de locação", () => {
  it("default é percentual (comportamento histórico)", () => {
    const parsed = comissaoLocacaoSchema.parse({});
    expect(parsed.forma_taxa_locacao).toBe("percentual");
    expect(parsed.taxa_locacao_percent).toBe(0);
    expect(parsed.taxa_locacao_valor).toBeUndefined();
  });

  it("aceita valor fixo", () => {
    const parsed = comissaoLocacaoSchema.parse({
      forma_taxa_locacao: "valor_fixo",
      taxa_locacao_valor: 800,
    });
    expect(parsed.forma_taxa_locacao).toBe("valor_fixo");
    expect(parsed.taxa_locacao_valor).toBe(800);
  });

  it("recusa forma desconhecida", () => {
    expect(
      comissaoLocacaoSchema.safeParse({ forma_taxa_locacao: "permuta" }).success
    ).toBe(false);
  });

  it("percentual segue limitado a 0-100", () => {
    expect(
      comissaoLocacaoSchema.safeParse({ taxa_locacao_percent: 120 }).success
    ).toBe(false);
  });
});

describe("taxaLocacaoEfetiva", () => {
  it("percentual incide sobre o primeiro aluguel", () => {
    expect(
      taxaLocacaoEfetiva(2500, {
        forma_taxa_locacao: "percentual",
        taxa_locacao_percent: 100,
      })
    ).toBe(2500);
    expect(
      taxaLocacaoEfetiva(2500, {
        forma_taxa_locacao: "percentual",
        taxa_locacao_percent: 50,
      })
    ).toBe(1250);
  });

  it("valor fixo ignora o aluguel — é o que permite mostrar o valor antes de o cliente preencher", () => {
    expect(
      taxaLocacaoEfetiva(0, {
        forma_taxa_locacao: "valor_fixo",
        taxa_locacao_valor: 800,
      })
    ).toBe(800);
  });

  it("entrada frouxa não vira NaN", () => {
    expect(taxaLocacaoEfetiva(null, null)).toBe(0);
    expect(taxaLocacaoEfetiva("", { taxa_locacao_percent: "" })).toBe(0);
    expect(
      taxaLocacaoEfetiva(1000, { forma_taxa_locacao: "valor_fixo" })
    ).toBe(0);
  });

  it("formaTaxaLocacao cai em percentual para qualquer coisa que não seja valor_fixo", () => {
    expect(formaTaxaLocacao(null)).toBe("percentual");
    expect(formaTaxaLocacao({ forma_taxa_locacao: "outra" })).toBe("percentual");
    expect(formaTaxaLocacao({ forma_taxa_locacao: "valor_fixo" })).toBe(
      "valor_fixo"
    );
  });
});

describe("resolveOrgLocacaoComissao", () => {
  it("org sem configuração cai no padrão de fábrica (zerado = sem sugestão)", () => {
    expect(resolveOrgLocacaoComissao(null)).toEqual(DEFAULT_LOCACAO_COMISSAO);
    expect(resolveOrgLocacaoComissao({})).toEqual(DEFAULT_LOCACAO_COMISSAO);
    expect(resolveOrgLocacaoComissao({ venda: {} })).toEqual(
      DEFAULT_LOCACAO_COMISSAO
    );
  });

  it("lê o branch locacao_comissao", () => {
    expect(
      resolveOrgLocacaoComissao({
        locacao_comissao: { forma: "valor_fixo", taxa_locacao_valor: 800 },
      })
    ).toEqual({
      forma: "valor_fixo",
      taxa_locacao_percent: 0,
      taxa_locacao_valor: 800,
    });
  });

  it("JSON corrompido no banco não derruba a criação do formulário", () => {
    expect(
      resolveOrgLocacaoComissao({
        locacao_comissao: {
          forma: 42,
          taxa_locacao_percent: "abc",
          taxa_locacao_valor: null,
        },
      })
    ).toEqual(DEFAULT_LOCACAO_COMISSAO);
  });

  it("não lê o branch de cláusulas (locacao) por engano", () => {
    expect(
      resolveOrgLocacaoComissao({ locacao: { taxa_locacao_percent: 99 } })
    ).toEqual(DEFAULT_LOCACAO_COMISSAO);
  });
});
