/**
 * Formatadores de dinheiro do painel de uso de IA.
 *
 * Módulo próprio, e não dentro do componente, por um motivo concreto: o
 * `formatUsdPreciso` precisava ser exportado de um arquivo `"use client"` só
 * para ser testável, o que ampliava a superfície pública do componente por
 * razão de teste. Função pura não tem nada de React — mora aqui, e o
 * componente importa.
 */

/**
 * Valor de KPI: duas casas, e tudo abaixo de um centavo colapsa em `$ <0,01`.
 *
 * O colapso é deliberado no cartão grande — "US$ 0,0004" num KPI de custo
 * total é ruído, não informação.
 */
export function formatUsd(v: number): string {
  if (v < 0.01) return "$ <0,01";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

/**
 * Valor pequeno com precisão de verdade.
 *
 * O `formatUsd` colapsa TUDO abaixo de um centavo — **inclusive zero**. Serve
 * para o KPI e não serve para a linha de procedência: um turn do Max custa
 * ~US$ 0,0004, então "medido vs estimado" apareceria como `$ <0,01 · $ <0,01`,
 * escondendo exatamente a diferença que a linha existe para mostrar. E com
 * zero estimado ela AFIRMARIA um custo que não existe.
 */
export function formatUsdPreciso(v: number): string {
  if (v === 0) return "$ 0";
  if (v < 0.01) return `$ ${v.toFixed(6).replace(".", ",")}`;
  return formatUsd(v);
}
