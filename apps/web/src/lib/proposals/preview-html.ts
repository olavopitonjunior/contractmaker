/**
 * Higienização do HTML da proposta antes de exibi-lo no `srcdoc` do iframe.
 *
 * Por que é necessário: `renderContratoHTML` compila o Handlebars com
 * `noEscape: true` (os templates trazem HTML de layout), então QUALQUER valor do
 * `dataJson` entra cru no documento. O `dataJson` vem de digitação humana e de
 * OCR — um nome com `<script>` viraria script executando no documento.
 *
 * Defesa em DUAS camadas, de propósito:
 *  1. aqui, removendo conteúdo ativo do markup;
 *  2. no componente, com `<iframe sandbox>` SEM `allow-scripts` e SEM
 *     `allow-same-origin` — mesmo que algo escape daqui, não roda nem enxerga a
 *     origem da aplicação.
 *
 * Não é um sanitizador de propósito geral (não há um no projeto e a superfície
 * aqui é conhecida): tira `<script>`, `<iframe>`, `<object>`, `<embed>`,
 * `<link>`, `<meta>`, handlers `on*=` e URLs `javascript:`. O resto do markup —
 * tabelas, estilos inline, a moldura do documento — passa intacto, que é o
 * ponto do preview.
 */
export function stripActiveContent(html: string): string {
  if (!html) return "";
  return (
    html
      // Tags que carregam ou executam conteúdo, com o conteúdo interno junto.
      .replace(/<\s*(script|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      // …e as versões sem fechamento (auto-fechadas ou truncadas).
      .replace(/<\s*(script|iframe|object|embed|noscript|link|meta|base)\b[^>]*>/gi, "")
      // Handlers inline: onclick=, onerror=, onload=… (aspas duplas, simples ou sem aspas).
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // href/src com javascript: (inclui a forma ofuscada "java\nscript:").
      .replace(
        /\s(href|src|xlink:href)\s*=\s*(["']?)\s*j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:[^"'>]*\2/gi,
        ""
      )
  );
}
