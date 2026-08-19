/**
 * Segmentos de path que aparecem como crumb intermediário mas NÃO têm
 * `page.tsx` NEM redirect — linká-los dá 404 (issue #320). O breadcrumb
 * renderiza esses crumbs como texto (role="link" aria-disabled, padrão do
 * design system).
 *
 * /deals e /locacao/deals também não têm page.tsx, mas ficam DE FORA da
 * lista: o next.config.js redireciona os dois pra /pipeline (PR #319), então
 * o link do crumb navega com sucesso — matá-lo seria regressão.
 *
 * A lista é estática porque o header é client component (não pode andar no
 * filesystem), mas NÃO é dívida cega: o teste breadcrumb-routes.test.ts anda
 * em `app/(dashboard)`, subtrai os paths cobertos por redirect do
 * next.config.js e exige igualdade exata — criou page.tsx ou redirect num
 * segmento listado, ou nasceu segmento morto fora da lista, o teste quebra.
 */
export const DEAD_SEGMENT_HREFS: ReadonlySet<string> = new Set([
  "/certidoes",
  "/relatorios",
  "/settings/pagamentos",
  "/settings/seguranca/audit-log/users",
]);

/**
 * Pais cujo segmento dinâmico ([id]) não tem página própria: o crumb "Detalhe"
 * de /forms/<id>/share linka /forms/<id>, que é 404 (só /share existe).
 */
export const DEAD_ID_PARENT_HREFS: ReadonlySet<string> = new Set(["/forms"]);

export function isDeadCrumb(
  href: string,
  isId: boolean,
  parentHref: string
): boolean {
  if (isId) return DEAD_ID_PARENT_HREFS.has(parentHref);
  return DEAD_SEGMENT_HREFS.has(href);
}
