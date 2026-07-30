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
