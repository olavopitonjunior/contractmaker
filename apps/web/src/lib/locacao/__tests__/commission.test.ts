import { describe, it, expect } from "vitest";
import {
  angariadorValorMensal,
  angariadorValorTotal,
  formaComissao,
  somaPercentuaisAngariadores,
  taxaLocacaoValor,
} from "../commission";

describe("taxaLocacaoValor (corretagem one-shot)", () => {
  it("aplica o percentual sobre o primeiro aluguel", () => {
    expect(taxaLocacaoValor(2500, 100)).toBe(2500);
    expect(taxaLocacaoValor(2500, 50)).toBe(1250);
    expect(taxaLocacaoValor(1833.33, 30)).toBe(550);
  });

  it("devolve 0 quando falta aluguel ou taxa (UI esconde o preview)", () => {
    expect(taxaLocacaoValor(0, 100)).toBe(0);
    expect(taxaLocacaoValor(2500, 0)).toBe(0);
    expect(taxaLocacaoValor(undefined, 100)).toBe(0);
    expect(taxaLocacaoValor(2500, undefined)).toBe(0);
    expect(taxaLocacaoValor("", "")).toBe(0);
  });

  it("ignora valores negativos e não-numéricos", () => {
    expect(taxaLocacaoValor(-2500, 100)).toBe(0);
    expect(taxaLocacaoValor(2500, -10)).toBe(0);
    expect(taxaLocacaoValor("abc", 10)).toBe(0);
  });

  it("arredonda a 2 casas sem vazar float", () => {
    // 1000.05 × 33.33% = 333.3166…
    expect(taxaLocacaoValor(1000.05, 33.33)).toBe(333.32);
  });
});

describe("formaComissao", () => {
  it("default é percentual (igual ao Zod)", () => {
    expect(formaComissao({})).toBe("percentual");
    expect(formaComissao(null)).toBe("percentual");
    expect(formaComissao({ forma_comissao: "qualquer_coisa" })).toBe("percentual");
    expect(formaComissao({ forma_comissao: "valor_fixo" })).toBe("valor_fixo");
  });
});

describe("angariadorValorMensal (comissão recorrente)", () => {
  it("percentual incide sobre o aluguel", () => {
    expect(
      angariadorValorMensal({ forma_comissao: "percentual", percentual: 10 }, 2500)
    ).toBe(250);
  });

  it("valor fixo ignora o aluguel", () => {
    expect(
      angariadorValorMensal({ forma_comissao: "valor_fixo", valor_fixo: 150 }, 2500)
    ).toBe(150);
    expect(
      angariadorValorMensal({ forma_comissao: "valor_fixo", valor_fixo: 150 }, 0)
    ).toBe(150);
  });

  it("percentual sem aluguel ainda não dá pra calcular", () => {
    expect(
      angariadorValorMensal({ forma_comissao: "percentual", percentual: 10 }, 0)
    ).toBe(0);
  });
});

describe("angariadorValorTotal", () => {
  it("multiplica pelos meses de comissão", () => {
    expect(
      angariadorValorTotal(
        { forma_comissao: "percentual", percentual: 10, meses_comissao: 12 },
        2500
      )
    ).toBe(3000);
  });

  it("meses ausente/0 = todo o contrato → total indeterminado (null)", () => {
    expect(
      angariadorValorTotal({ forma_comissao: "valor_fixo", valor_fixo: 150 }, 2500)
    ).toBeNull();
    expect(
      angariadorValorTotal(
        { forma_comissao: "valor_fixo", valor_fixo: 150, meses_comissao: 0 },
        2500
      )
    ).toBeNull();
  });

  it("mensal 0 com meses definidos devolve 0, não null", () => {
    expect(
      angariadorValorTotal(
        { forma_comissao: "percentual", percentual: 10, meses_comissao: 12 },
        0
      )
    ).toBe(0);
  });
});

describe("somaPercentuaisAngariadores", () => {
  it("soma só quem está em percentual", () => {
    expect(
      somaPercentuaisAngariadores([
        { forma_comissao: "percentual", percentual: 40 },
        { forma_comissao: "percentual", percentual: 35.5 },
        { forma_comissao: "valor_fixo", valor_fixo: 500, percentual: 90 },
      ])
    ).toBe(75.5);
  });

  it("lista vazia/ausente soma 0", () => {
    expect(somaPercentuaisAngariadores([])).toBe(0);
    expect(somaPercentuaisAngariadores(undefined)).toBe(0);
    expect(somaPercentuaisAngariadores(null)).toBe(0);
  });
});
