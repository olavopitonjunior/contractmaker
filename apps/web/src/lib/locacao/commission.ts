/**
 * Cálculos puros da comissão de LOCAÇÃO. Fonte única do preview em R$ mostrado
 * na UI do operador (ComissaoLocacaoSection) e base dos testes.
 *
 * Dois conceitos distintos — não misturar:
 *
 *  - **Corretagem** (`comissao.taxa_locacao_percent`): percentual sobre o
 *    PRIMEIRO aluguel, devido à imobiliária uma única vez pela intermediação.
 *    É o que a cláusula 5.2 do `administracao_locacao_v1.hbs` renderiza.
 *  - **Comissão recorrente do angariador** (`comissao.angariadores[]`): o
 *    corretor que captou o imóvel recebe todo mês, por percentual do aluguel
 *    OU por valor fixo, durante `meses_comissao` (0/ausente = todo o contrato).
 *
 * Valores frouxos (`unknown`) porque a entrada vem tanto de um form controlado
 * quanto de um `dataJson` cru vindo do banco/OCR.
 */

export type FormaComissaoAngariador = "percentual" | "valor_fixo";

export interface AngariadorCalcInput {
  forma_comissao?: unknown;
  percentual?: unknown;
  valor_fixo?: unknown;
  meses_comissao?: unknown;
}

/** Número finito ≥ 0, ou 0. Blinda string vazia, null, NaN e negativo. */
function positiveNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Arredonda a 2 casas sem vazar float (0.1 + 0.2). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Forma de comissão normalizada — default `percentual` (igual ao Zod). */
export function formaComissao(a: AngariadorCalcInput | null | undefined): FormaComissaoAngariador {
  return a?.forma_comissao === "valor_fixo" ? "valor_fixo" : "percentual";
}

/**
 * Corretagem em R$: `taxa_locacao_percent`% do primeiro aluguel. Devolve 0
 * quando falta o valor do aluguel (o form do cliente ainda não passou) — a UI
 * usa isso pra esconder o preview em vez de mostrar "R$ 0,00".
 */
export function taxaLocacaoValor(
  valorAluguel: unknown,
  taxaLocacaoPercent: unknown
): number {
  const aluguel = positiveNumber(valorAluguel);
  const percent = positiveNumber(taxaLocacaoPercent);
  if (aluguel === 0 || percent === 0) return 0;
  return round2((aluguel * percent) / 100);
}

export interface ComissaoCalcInput {
  forma_taxa_locacao?: unknown;
  taxa_locacao_percent?: unknown;
  taxa_locacao_valor?: unknown;
}

/** Forma da taxa de locação normalizada — default `percentual` (igual ao Zod). */
export function formaTaxaLocacao(
  c: ComissaoCalcInput | null | undefined
): FormaComissaoAngariador {
  return c?.forma_taxa_locacao === "valor_fixo" ? "valor_fixo" : "percentual";
}

/**
 * Corretagem efetiva em R$, seja qual for a forma escolhida. Em `valor_fixo` o
 * aluguel é irrelevante — é o que permite mostrar o valor da comissão antes de
 * o cliente preencher o formulário.
 */
export function taxaLocacaoEfetiva(
  valorAluguel: unknown,
  comissao: ComissaoCalcInput | null | undefined
): number {
  if (formaTaxaLocacao(comissao) === "valor_fixo") {
    return round2(positiveNumber(comissao?.taxa_locacao_valor));
  }
  return taxaLocacaoValor(valorAluguel, comissao?.taxa_locacao_percent);
}

/**
 * Quanto o angariador recebe POR MÊS. `percentual` incide sobre o aluguel;
 * `valor_fixo` é o valor cru. 0 quando não dá pra calcular.
 */
export function angariadorValorMensal(
  angariador: AngariadorCalcInput | null | undefined,
  valorAluguel: unknown
): number {
  if (!angariador) return 0;
  if (formaComissao(angariador) === "valor_fixo") {
    return round2(positiveNumber(angariador.valor_fixo));
  }
  const aluguel = positiveNumber(valorAluguel);
  const percent = positiveNumber(angariador.percentual);
  if (aluguel === 0 || percent === 0) return 0;
  return round2((aluguel * percent) / 100);
}

/**
 * Total ao longo do contrato. `meses_comissao` ausente/0 significa "todo o
 * contrato" — sem saber a vigência não existe total fechado, então devolve
 * `null` e a UI mostra "por todo o contrato".
 */
export function angariadorValorTotal(
  angariador: AngariadorCalcInput | null | undefined,
  valorAluguel: unknown
): number | null {
  const meses = positiveNumber(angariador?.meses_comissao);
  if (meses === 0) return null;
  const mensal = angariadorValorMensal(angariador, valorAluguel);
  if (mensal === 0) return 0;
  return round2(mensal * meses);
}

/**
 * Soma dos percentuais dos angariadores em forma `percentual`. Serve pro aviso
 * de "excede 100% do aluguel" (espelha o somatório do passo de comissão de
 * venda). Angariadores em `valor_fixo` não entram na conta.
 */
export function somaPercentuaisAngariadores(
  angariadores: readonly AngariadorCalcInput[] | null | undefined
): number {
  if (!Array.isArray(angariadores)) return 0;
  const total = angariadores.reduce(
    (acc, a) =>
      acc + (formaComissao(a) === "percentual" ? positiveNumber(a.percentual) : 0),
    0
  );
  return round2(total);
}

/**
 * Shape mínimo da comissão vinda do diálogo do operador (o Zod completo mora em
 * validation-locacao; aqui basta o que decide o padrão).
 */
export interface ComissaoSeedInput {
  forma_taxa_locacao?: "percentual" | "valor_fixo";
  taxa_locacao_percent?: number;
  taxa_locacao_valor?: number;
  angariadores?: unknown[];
}

/**
 * O operador digitou uma taxa NESTE negócio?
 *
 * O gatilho do padrão da casa é a taxa ZERADA, não a AUSÊNCIA de `comissao`: o
 * diálogo do operador sempre manda o objeto (com `taxa_locacao_percent: 0`
 * quando ninguém digitou nada), então checar só `!comissao` faria o padrão
 * nunca ser aplicado.
 */
export function taxaFoiInformada(
  comissao: ComissaoSeedInput | null | undefined
): boolean {
  if (!comissao) return false;
  return comissao.forma_taxa_locacao === "valor_fixo"
    ? positiveNumber(comissao.taxa_locacao_valor) > 0
    : positiveNumber(comissao.taxa_locacao_percent) > 0;
}

/**
 * Sobrepõe o padrão comercial da org na taxa da imobiliária, PRESERVANDO os
 * angariadores que o operador já tenha adicionado — o padrão da casa é só sobre
 * a taxa. Padrão zerado ("não configurado") devolve a entrada intacta, e o
 * formulário nasce em branco como sempre nasceu.
 */
export function aplicarPadraoComissao<T extends ComissaoSeedInput>(
  comissao: T | undefined,
  padrao: {
    forma: "percentual" | "valor_fixo";
    taxa_locacao_percent: number;
    taxa_locacao_valor: number;
  }
): T | undefined {
  const temPadrao =
    padrao.forma === "valor_fixo"
      ? padrao.taxa_locacao_valor > 0
      : padrao.taxa_locacao_percent > 0;
  if (!temPadrao) return comissao;
  return {
    ...((comissao ?? { angariadores: [] }) as T),
    forma_taxa_locacao: padrao.forma,
    taxa_locacao_percent: padrao.taxa_locacao_percent,
    taxa_locacao_valor: padrao.taxa_locacao_valor,
  };
}

/**
 * Rateio do PRIMEIRO aluguel: quanto cabe à imobiliária e quanto a cada
 * corretor, em R$.
 *
 * É a conta da cláusula que a Trio escreve como uma lista — "a) R$ X à
 * imobiliária intermediadora; b) R$ Y ao corretor; c) R$ Z ao corretor" — e
 * cuja soma, nos contratos reais, fecha um aluguel inteiro.
 *
 * REGRA DECIDIDA pelo dono do produto em 03/09/2026: os corretores recebem de
 * DENTRO da taxa de locação, não além dela — a parte da imobiliária é a taxa
 * MENOS a soma das partes dos corretores. Com aluguel de R$ 5.000, taxa de um
 * aluguel e corretores levando R$ 1.500 + R$ 1.000, a lista soma R$ 5.000 (um
 * aluguel) e a imobiliária fica com R$ 2.500 — não R$ 5.000 com a lista somando
 * R$ 7.500. Se algum dia existir imobiliária que cobre "além da taxa", isso é
 * um booleano novo no schema da comissão; o texto da cláusula não muda, só a
 * conta.
 *
 * A parte de cada corretor é `valor_primeiro_aluguel` quando informada; sem
 * ela, a comissão do mês 1 (que é o que o campo mostra como padrão). Nunca
 * negativa: se a soma passar da taxa, a parte da imobiliária é 0 e `excede`
 * fica `true`.
 *
 * `excede` existe porque o render NÃO tem como avisar: a cláusula simplesmente
 * sai sem a imobiliária, sem "R$ 0,00" e sem linha nenhuma. Quem avisa é
 * `ComissaoLocacaoSection` — um erro de digitação no valor de um corretor zera
 * a comissão da própria imobiliária num contrato assinado, e isso não pode
 * acontecer em silêncio.
 */
export interface RateioPrimeiroAluguel {
  /** Parte da imobiliária, em R$. Nunca negativa. */
  imobiliaria: number;
  /** Parte de cada angariador, na ordem do array de entrada. */
  angariadores: number[];
  /** Taxa de locação efetiva — o total que a lista deve somar. */
  total: number;
  /** A soma das partes dos corretores passou da taxa de locação. */
  excede: boolean;
}

export interface AngariadorRateioInput extends AngariadorCalcInput {
  valor_primeiro_aluguel?: unknown;
}

export function rateioPrimeiroAluguel(
  valorAluguel: unknown,
  comissao:
    | (ComissaoCalcInput & { angariadores?: readonly AngariadorRateioInput[] | null })
    | null
    | undefined
): RateioPrimeiroAluguel {
  const total = taxaLocacaoEfetiva(valorAluguel, comissao);
  const lista = Array.isArray(comissao?.angariadores) ? comissao!.angariadores! : [];
  const angariadores = lista.map((a) => {
    const informado = positiveNumber(a?.valor_primeiro_aluguel);
    return informado > 0 ? round2(informado) : angariadorValorMensal(a, valorAluguel);
  });
  const soma = round2(angariadores.reduce((acc, v) => acc + v, 0));
  return {
    imobiliaria: round2(Math.max(0, total - soma)),
    angariadores,
    total,
    excede: soma > total,
  };
}
