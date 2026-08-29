import { describe, it, expect } from "vitest";
import { buildConsolidatedFormSummary } from "@/lib/forms/form-summary";
import { renderFormSummaryText } from "@/lib/contract-review/reviewer";

/**
 * O resumo NUNCA imprime os dados bancários do corretor — afirmado sobre a
 * SAÍDA, não sobre o registro de omissão.
 *
 * Já existe o `form-summary-coverage.test.ts`, que percorre o Zod e exige que
 * todo campo folha apareça no resumo ou esteja na allowlist com motivo. Ele
 * garante que ninguém ESQUEÇA de decidir — mas prova o contrário do que
 * interessa aqui: uma entrada em `OMITIDOS_COM_MOTIVO` diz "decidimos não
 * mostrar", e não "o valor de fato não sai". Um `pushIf` novo em outra seção,
 * ou um enrich que copie o sub-objeto para outro lugar, passaria por ele.
 *
 * Este teste fecha esse flanco pelo outro lado: monta um formulário com valores
 * bancários reconhecíveis e afirma que nenhum deles aparece no texto do resumo.
 * O mesmo texto que vai para a tela, o PDF, o e-mail e o prompt do LLM de
 * revisão de contrato — que é o caminho que sai da imobiliária.
 *
 * Nasceu do smoke de staging de 28/08: buscar os valores nos bytes do PDF não
 * prova nada, porque os streams saem comprimidos (nem "Comissionados" aparece).
 * A fonte é a mesma e aqui ela é legível.
 */

const BANCO = "BancoSentinelaXYZ";
const CONTA = "98765-4";
const AGENCIA = "7777";
const PIX = "sentinela@pix.example";

function formComDadoBancario() {
  return {
    imoveis: [
      {
        rua: "Rua das Flores",
        cidade: "São Paulo",
        uf: "SP",
        descricao: "Apartamento de 2 quartos.",
      },
    ],
    comissao: {
      quem_paga: "comprador",
      comissionados: [
        {
          nome: "Imobiliária Teste Ltda",
          cnpj: "11.222.333/0001-81",
          tipo_pessoa: "juridica",
          email: "contato@teste.com",
          papel: "imobiliaria_principal",
          splitRecipientId: "sr1",
          recebimentoPendente: true,
          recebimento: {
            banco: BANCO,
            agencia: AGENCIA,
            conta: CONTA,
            tipo_conta: "corrente",
            pix_chave: PIX,
            titular_nome: "Titular Sentinela",
            titular_doc: "390.533.447-05",
          },
        },
      ],
    },
    pagamento: { valor_total: 850000 },
  };
}

describe("resumo consolidado — dados bancários do corretor", () => {
  const sections = buildConsolidatedFormSummary(formComDadoBancario(), {
    schemaType: "compra_venda_v1",
  });
  const texto = renderFormSummaryText(sections);

  it("o comissionado APARECE no resumo — senão o teste não prova nada", () => {
    // Guarda do guarda: se um dia a seção de comissionados sumir do resumo, as
    // asserções negativas abaixo passariam por vacuidade.
    expect(texto).toContain("Imobiliária Teste Ltda");
  });

  for (const [rotulo, valor] of [
    ["banco", BANCO],
    ["conta", CONTA],
    ["agência", AGENCIA],
    ["chave PIX", PIX],
    ["titular", "Titular Sentinela"],
  ] as const) {
    it(`não imprime ${rotulo}`, () => {
      expect(texto).not.toContain(valor);
    });
  }

  it("também não imprime o rótulo de recebimento do corretor", () => {
    // O `recebimento` das PARTES é exibido e usa o mesmo vocabulário; o que não
    // pode existir é uma linha dessas DENTRO da seção de comissionados.
    const secaoComissionados = sections.find((s) =>
      /comission/i.test(s.title ?? "")
    );
    const linhas = JSON.stringify(secaoComissionados ?? {});
    expect(linhas).not.toMatch(/recebimento/i);
    expect(linhas).not.toContain(BANCO);
  });
});
