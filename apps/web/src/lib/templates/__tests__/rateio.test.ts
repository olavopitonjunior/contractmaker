import { describe, it, expect, vi } from "vitest";

// Render real: o setup global mocka `renderContratoHTML`, e este módulo depende
// dos helpers BR de verdade (moeda, extenso).
vi.unmock("@/lib/render/handlebars");

import { rateioPrimeiroAluguel } from "../rateio";
import { rateioPrimeiroAluguel as rateioValores } from "@/lib/locacao/commission";
import type { RegistroCorretor } from "../corretagem";

/**
 * O caso é o da RE/MAX Trio: a cláusula 4.1.1 abre a lista e os itens somam um
 * aluguel inteiro — a) à imobiliária, b) e c) aos corretores que captaram.
 */

/** `moeda` emite NBSP depois de "R$" (padrão pt-BR do Intl); normaliza p/ casar. */
const render = (...args: Parameters<typeof rateioPrimeiroAluguel>) =>
  rateioPrimeiroAluguel(...args).replace(/ /g, " ");

function dados(over: Record<string, unknown> = {}) {
  return {
    aluguel: { valor: 5000 },
    config: {
      imobiliaria_nome: "Trio Negócios Imobiliários Ltda",
      imobiliaria_cnpj: "12.345.678/0001-90",
      imobiliaria_creci: "79.434-J",
    },
    comissao: {
      forma_taxa_locacao: "valor_fixo",
      taxa_locacao_valor: 5000,
      angariadores: [
        { nome: "Ana Ribeiro", cpf: "529.982.247-25", creci: "12345-F", valor_primeiro_aluguel: 1500 },
        { nome: "Bruno Tavares", cpf: "111.444.777-35", creci: "54321-F", valor_primeiro_aluguel: 1000 },
      ],
    },
    ...over,
  } as Record<string, unknown>;
}

describe("rateioPrimeiroAluguel — a lista da cláusula", () => {
  it("monta um item por beneficiário, com letra, valor e extenso", () => {
    const itens = render(dados(), {
      imobiliariaVia: "da chave PIX (CNPJ) 12.345.678/0001-90",
    }).split("\n");

    expect(itens).toHaveLength(3);
    expect(itens[0]).toMatch(/^a\) R\$ 2\.500,00 \(dois mil e quinhentos reais\)/);
    // O nome cola no tratamento sem vírgula, senão lê como duas partes.
    expect(itens[0]).toContain("à imobiliária intermediadora Trio Negócios Imobiliários Ltda");
    expect(itens[0]).toContain("inscrita no CNPJ sob nº 12.345.678/0001-90");
    expect(itens[0]).toContain("como honorários pela intermediação imobiliária na presente locação");
    expect(itens[0]).toContain("por meio da chave PIX (CNPJ) 12.345.678/0001-90");
    expect(itens[0].endsWith(";")).toBe(true);

    expect(itens[1]).toMatch(/^b\) R\$ 1\.500,00 \(mil e quinhentos reais\)/);
    expect(itens[1]).toContain("ao(à) corretor(a) intermediador(a) Ana Ribeiro");
    expect(itens[1]).toContain("CRECI nº 12345-F");
    // Só a imobiliária leva a razão do pagamento.
    expect(itens[1]).not.toContain("honorários");

    expect(itens[2]).toMatch(/^c\) R\$ 1\.000,00/);
    expect(itens[2]).toContain("Bruno Tavares");
    expect(itens[2].endsWith(".")).toBe(true);
  });

  it("a soma dos itens fecha a taxa de locação", () => {
    const v = rateioValores(5000, {
      forma_taxa_locacao: "valor_fixo",
      taxa_locacao_valor: 5000,
      angariadores: [{ valor_primeiro_aluguel: 1500 }, { valor_primeiro_aluguel: 1000 }],
    });
    expect(v.imobiliaria + v.angariadores[0] + v.angariadores[1]).toBe(5000);
    expect(v.excede).toBe(false);
  });

  it("sem corretor, a lista é só a imobiliária e termina em ponto", () => {
    const txt = render(
      dados({
        comissao: { forma_taxa_locacao: "valor_fixo", taxa_locacao_valor: 3000, angariadores: [] },
      })
    );
    expect(txt.split("\n")).toHaveLength(1);
    expect(txt).toMatch(/^a\) R\$ 3\.000,00/);
    expect(txt.endsWith(".")).toBe(true);
  });

  it("sem via de repasse, a frase não promete um meio de pagamento", () => {
    const txt = render(dados());
    expect(txt).not.toContain("por meio");
    expect(txt).toContain("à imobiliária intermediadora");
  });

  it("usa a comissão do mês 1 quando o valor do 1º aluguel não foi informado", () => {
    const txt = render(
      dados({
        comissao: {
          forma_taxa_locacao: "valor_fixo",
          taxa_locacao_valor: 5000,
          // 20% de 5000 = 1000 no mês 1.
          angariadores: [{ nome: "Ana Ribeiro", forma_comissao: "percentual", percentual: 20 }],
        },
      })
    );
    expect(txt).toContain("R$ 4.000,00");
    expect(txt).toContain("R$ 1.000,00");
  });

  it("soma acima da taxa: a parte da imobiliária é zero e ela sai da lista", () => {
    const comissao = {
      forma_taxa_locacao: "valor_fixo",
      taxa_locacao_valor: 2000,
      angariadores: [
        { nome: "Ana Ribeiro", valor_primeiro_aluguel: 1500 },
        { nome: "Bruno Tavares", valor_primeiro_aluguel: 1000 },
      ],
    };
    const v = rateioValores(5000, comissao);
    expect(v.imobiliaria).toBe(0);
    expect(v.excede).toBe(true);

    // A lista não imprime "R$ 0,00 à imobiliária" — item de valor zero não entra.
    const itens = render(dados({ comissao })).split("\n");
    expect(itens).toHaveLength(2);
    expect(itens.join("\n")).not.toContain("imobiliária intermediadora");
    expect(itens[0]).toMatch(/^a\) R\$ 1\.500,00/);
    expect(itens[1]).toMatch(/^b\) R\$ 1\.000,00/);
  });

  it("sem taxa de locação não há rateio: chave vazia", () => {
    expect(render(dados({ comissao: { taxa_locacao_percent: 0, angariadores: [] } }))).toBe("");
  });

  it("corretor sem nome não vira item — melhor faltar do que dizer 'pago a alguém'", () => {
    const itens = render(
      dados({
        comissao: {
          forma_taxa_locacao: "valor_fixo",
          taxa_locacao_valor: 4000,
          angariadores: [{ valor_primeiro_aluguel: 1000 }],
        },
      })
    ).split("\n");
    expect(itens).toHaveLength(1);
    expect(itens[0]).toContain("imobiliária intermediadora");
    expect(itens[0]).not.toContain("corretor(a) intermediador(a)");
  });

  it("contrato IMPORTADO (comissionados) rateia igual ao de locação (angariadores)", () => {
    // `corretoresDe` aceita os dois vocabulários — locação grava
    // `angariadores`, e um contrato importado passa pelo extrator de CCV, que
    // fala o de venda (`comissionados`). Enquanto o cálculo lia
    // `comissao.angariadores` por conta própria, o importado saía com a
    // imobiliária recebendo o aluguel INTEIRO e o corretor sumindo sem aviso:
    // valor errado num contrato assinado, não só um item faltando.
    const corretor = { nome: "Ana Ribeiro", cpf: "529.982.247-25", valor_primeiro_aluguel: 1500 };
    const taxa = { forma_taxa_locacao: "valor_fixo", taxa_locacao_valor: 5000 };

    const comAngariadores = render(dados({ comissao: { ...taxa, angariadores: [corretor] } }));
    const comComissionados = render(dados({ comissao: { ...taxa, comissionados: [corretor] } }));

    expect(comComissionados).toBe(comAngariadores);
    expect(comComissionados.split("\n")).toHaveLength(2);
    expect(comComissionados).toContain("R$ 3.500,00");
    expect(comComissionados).toContain("R$ 1.500,00");
    expect(comComissionados).toContain("Ana Ribeiro");
  });

  it("resolve a via do corretor pelo cadastro quando o formulário não a traz", () => {
    const registro: RegistroCorretor[] = [
      {
        id: "rec1",
        cpfCnpj: "52998224725",
        recebimento: {
          forma: "pix",
          pix_chave: "ana@exemplo.test",
          pix_tipo: "EMAIL",
          titular_nome: "Ana Ribeiro",
        } as never,
      },
    ];
    const txt = render(
      dados({
        comissao: {
          forma_taxa_locacao: "valor_fixo",
          taxa_locacao_valor: 5000,
          angariadores: [
            { nome: "Ana Ribeiro", cpf: "529.982.247-25", valor_primeiro_aluguel: 1500 },
          ],
        },
      }),
      { registro }
    );
    expect(txt).toContain("ana@exemplo.test");
  });
});
