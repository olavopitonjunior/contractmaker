/**
 * Cláusula de RATEIO DO PRIMEIRO ALUGUEL, em prosa.
 *
 * Por que existe: nos contratos da RE/MAX Trio a cláusula 4.1.1 abre uma lista
 * e cada item nomeia um beneficiário com o seu valor —
 *
 *   a) R$ 2.500,00 (dois mil e quinhentos reais), a ser pago diretamente à
 *      imobiliária intermediadora …, como honorários pela intermediação
 *      imobiliária na presente locação, por meio de PIX …;
 *   b) R$ 1.200,00 …, a ser pago diretamente ao(à) corretor(a)
 *      intermediador(a) …, por meio de …;
 *
 * — e a soma dos itens fecha um aluguel inteiro. Não havia chave para isso. Na
 * padronização de 03/09/2026, b) e c) ficaram com UMA chave de corretagem cada:
 * `{{corretagem_dados_pagamento}}` imprime conta sem nome, e
 * `{{corretagem_qualificacao}}` imprime nome sem conta — e, com dois
 * corretores, as duas repetem o bloco inteiro nos dois itens. Chaveado item por
 * item o resultado é sempre errado; a lista tem que ser UMA chave.
 *
 * A conta em R$ não mora aqui: é de `lib/locacao/commission.ts`, que é dono da
 * matemática de comissão. Este módulo só transforma números e qualificações em
 * frase — o mesmo desenho de `./corretagem` e `./imobiliaria`.
 */
import { rateioPrimeiroAluguel as rateioValores } from "@/lib/locacao/commission";
import {
  corretoresDe,
  qualificacaoDeCorretor,
  repasseDe,
  txt,
  type RegistroCorretor,
} from "./corretagem";
import { imobiliariaQualificacao } from "./imobiliaria";
import { hbsExpr } from "./composed-blocks";

/** Letras dos itens da lista: a), b), c)… */
const LETRAS = "abcdefghijklmnopqrstuvwxyz";

export interface RateioOptions {
  /** Via de recebimento da PRÓPRIA imobiliária (vem do cadastro da org). */
  imobiliariaVia?: string;
  /** Cadastro de corretores, para resolver a via de cada um. */
  registro?: RegistroCorretor[];
}

/** Um item da lista, já com valor e beneficiário resolvidos. */
interface ItemRateio {
  valor: number;
  /** "à imobiliária intermediadora" / "ao(à) corretor(a) intermediador(a)". */
  tratamento: string;
  qualificacao: string;
  via: string;
  /** Só a imobiliária leva a razão do pagamento ("como honorários…"). */
  honorarios: boolean;
}

function moeda(valor: number): string {
  return hbsExpr("moeda valor", { valor });
}

function extenso(valor: number): string {
  return hbsExpr("extenso valor", { valor });
}

function frase(item: ItemRateio, letra: string, ultimo: boolean): string {
  // O nome cola no tratamento SEM vírgula ("à imobiliária intermediadora Trio
  // Ltda, inscrita no CNPJ…"): com vírgula sai "ao(à) corretor(a)
  // intermediador(a), Ana Ribeiro", que lê como se fossem duas partes.
  const alvo = item.qualificacao
    ? `${item.tratamento} ${item.qualificacao}`
    : item.tratamento;
  const partes = [`${moeda(item.valor)} (${extenso(item.valor)})`];
  partes.push(`a ser pago diretamente ${alvo}`);
  if (item.honorarios) {
    partes.push("como honorários pela intermediação imobiliária na presente locação");
  }
  if (item.via) partes.push(`por meio ${item.via}`);
  return `${letra}) ${partes.join(", ")}${ultimo ? "." : ";"}`;
}

/**
 * A lista inteira, um parágrafo por item. "" quando não há valor a ratear — o
 * modelo fica com o parágrafo vazio em vez de uma frase pela metade, como as
 * outras chaves compostas de corretagem.
 *
 * A imobiliária é sempre o item a) quando lhe cabe algum valor; os corretores
 * seguem na ordem em que estão no formulário. Corretor sem nome não entra: um
 * item que diz "pago diretamente ao(à) corretor(a) intermediador(a)" sem dizer
 * a quem é pior que a ausência do item.
 */
export function rateioPrimeiroAluguel(
  data: Record<string, unknown>,
  options: RateioOptions = {}
): string {
  const comissao = (data?.comissao ?? {}) as Record<string, unknown>;
  const aluguel = (data?.aluguel ?? {}) as Record<string, unknown>;
  const registro = options.registro ?? [];
  // A MESMA lista nas duas pontas. `corretoresDe` aceita `angariadores` (o
  // vocabulário de locação) OU `comissionados` (o de venda, que é o que um
  // contrato IMPORTADO carrega, porque passou pelo extrator de CCV). Deixar o
  // cálculo ler `comissao.angariadores` por conta própria produzia, num
  // contrato importado, uma lista com a imobiliária recebendo o aluguel INTEIRO
  // e o corretor sumindo sem aviso — valor errado num contrato assinado, não só
  // um item faltando. Passar a lista resolvida também garante que o valor do
  // índice i pertence ao corretor do índice i.
  const corretores = corretoresDe(data);
  const valores = rateioValores(aluguel.valor, {
    ...comissao,
    angariadores: corretores,
  } as never);
  if (valores.total <= 0) return "";

  const itens: ItemRateio[] = [];
  if (valores.imobiliaria > 0) {
    itens.push({
      valor: valores.imobiliaria,
      tratamento: "à imobiliária intermediadora",
      qualificacao: imobiliariaQualificacao(data),
      via: txt(options.imobiliariaVia),
      honorarios: true,
    });
  }
  corretores.forEach((c, i) => {
    const valor = valores.angariadores[i] ?? 0;
    const qualificacao = qualificacaoDeCorretor(c);
    if (valor <= 0 || !qualificacao) return;
    itens.push({
      valor,
      tratamento: "ao(à) corretor(a) intermediador(a)",
      qualificacao,
      via: repasseDe(c, registro),
      honorarios: false,
    });
  });

  if (itens.length === 0) return "";
  return itens
    .map((item, i) => frase(item, LETRAS[i] ?? String(i + 1), i === itens.length - 1))
    .join("\n");
}
