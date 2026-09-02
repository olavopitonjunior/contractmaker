/**
 * Catálogo de CHAVES Handlebars válidas numa cláusula, e o validador que
 * decide se uma chave proposta pela IA pode virar texto contratual.
 *
 * Este módulo é a rede de segurança determinística do classificador: o LLM
 * propõe "este trecho literal vira esta chave", e nada é aplicado sem passar
 * por aqui. Um LLM que erra é BARRADO, não aplicado.
 *
 * ## Duas armadilhas que este módulo existe pra evitar
 *
 * **1. O vocabulário não é o fixture cru.** `buildTemplatePreviewContext`
 * (`lib/templates/preview-context.ts`) roda `enrichContractData` /
 * `enrichLocacaoData` / `enrichAdministracaoData` antes de renderizar, e boa
 * parte de `config.*` só existe DEPOIS do enrich. Validar contra
 * `getPreviewSampleData` cru reprovaria chave correta.
 *
 * **2. "Resolve não-vazio" não pode ser critério único.** O fixture de locação
 * traz `garantia.tipo = "titulo_capitalizacao"`, então `{{garantia.caucao_meses}}`
 * — chave de uma cláusula de seed REAL — resolve vazio. Reprová-la seria
 * reprovar o acervo curado. Daí os três tiers abaixo.
 *
 * Server-only: importa o pipeline de render (Handlebars).
 */
import {
  buildTemplatePreviewContext,
  buildTemplatePreviewHtml,
} from "@/lib/templates/preview-context";
import { HANDLEBARS_HELPER_NAMES } from "@/lib/render/handlebars";
import { GARANTIA_TIPOS } from "@/lib/contracts/template-category";
import {
  ESTEIRA_PRIMARY_FIXTURE,
  ESTEIRA_FIXTURES,
} from "@/lib/clauses/taxonomy";
import type { FormModule } from "@/lib/forms/presets";

/**
 * - `validada`: resolve não-vazio no fixture PRIMÁRIO da esteira. Aplicável.
 * - `condicional`: só resolve em fixture secundário ou em outra variante de
 *   garantia. Vira proposta, mas marcada — a UI exige uma confirmação extra.
 * - `rejeitada`: fora do catálogo. Descartada; nunca chega ao revisor.
 */
export type KeyTier = "validada" | "condicional" | "rejeitada";

/**
 * Tokens de bloco/contexto que não são caminho de dado.
 *
 * Inclui os BLOCK HELPERS EMBUTIDOS do Handlebars. Eles não podem viver em
 * `HANDLEBARS_HELPER_NAMES` porque aquela lista tem paridade travada por teste
 * com o que `registerHandlebarsHelpers` de fato registra — e `if`/`each` vêm da
 * biblioteca, não do app. Como não estavam em lista nenhuma,
 * `extractHandlebarsPaths("{{#if x}}")` devolvia `["if", "x"]`, o catálogo
 * rejeitava `if`, e `classify/apply` — que revalida TODA chave do conteúdo
 * final — recusava aplicar proposta de conteúdo em qualquer cláusula
 * condicional, em silêncio (issue #486).
 */
const NON_PATH_TOKENS = new Set([
  "this",
  "else",
  "@index",
  "@key",
  "@first",
  "@last",
  "@root",
  // Block helpers embutidos do Handlebars.
  "if",
  "unless",
  "each",
  "with",
  "log",
  "lookup",
]);

const HELPERS = new Set(HANDLEBARS_HELPER_NAMES);

/**
 * Extrai os caminhos de dado de um conteúdo Handlebars.
 *
 * Ignora abertura/fechamento de bloco (`{{#if}}`, `{{/each}}`), comentários e
 * literais. Quando o primeiro token é helper conhecido, pula para o primeiro
 * argumento que seja caminho — é assim que `{{moeda aluguel.valor}}` devolve
 * `aluguel.valor` e não `moeda`.
 */
export function extractHandlebarsPaths(content: string): string[] {
  const out = new Set<string>();
  // Casa {{ ... }} e {{{ ... }}}; o corpo não pode conter chaves.
  const re = /\{\{\{?([^{}]+)\}?\}\}/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    const body = m[1].trim();
    if (!body) continue;
    // Comentário, partial, fechamento de bloco.
    if (body.startsWith("!") || body.startsWith(">") || body.startsWith("/")) continue;

    // Abertura de bloco: `#if x`, `#each lista` — o argumento ainda é caminho.
    const inner = body.startsWith("#") || body.startsWith("^") ? body.slice(1).trim() : body;
    if (!inner) continue;

    // Tokeniza respeitando strings entre aspas (que são literais, não caminhos).
    const tokens = inner.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      const raw = tokens[i];
      // Literal, número, booleano, hash de parâmetro (`key=value`).
      if (/^["']/.test(raw)) continue;
      if (/^-?\d+(\.\d+)?$/.test(raw)) continue;
      if (raw === "true" || raw === "false" || raw === "null" || raw === "undefined") continue;
      if (raw.includes("=")) continue;

      const token = raw.replace(/^\(|\)+$/g, "");
      if (!token) continue;
      // O primeiro token, se helper, não é caminho — os seguintes podem ser.
      if (i === 0 && HELPERS.has(token)) continue;
      if (HELPERS.has(token)) continue;
      if (NON_PATH_TOKENS.has(token)) continue;
      if (token.startsWith("@")) continue;
      // `this.x` referencia o item do `#each`; não é caminho da raiz.
      if (token.startsWith("this.") || token.startsWith("../")) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(token)) continue;

      out.add(token);
    }
  }
  return [...out];
}

/** Caminhos-folha com valor "presente" num objeto de contexto já enriquecido. */
function collectPaths(
  node: unknown,
  prefix: string,
  out: Set<string>,
  depth = 0
): void {
  if (depth > 6 || node === null || node === undefined) return;

  if (Array.isArray(node)) {
    // O caminho do array em si é utilizável (`{{#each parcelas}}`, `.length`).
    if (prefix) {
      out.add(prefix);
      out.add(`${prefix}.length`);
    }
    // Estrutura dos itens: o 1º elemento representa a forma dos demais.
    if (node.length > 0) collectPaths(node[0], prefix, out, depth + 1);
    return;
  }

  if (typeof node === "object") {
    if (prefix) out.add(prefix);
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      collectPaths(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
    return;
  }

  // Folha: só conta como disponível quando tem conteúdo de fato.
  if (node === "" || node === false) return;
  if (prefix) out.add(prefix);
}

/**
 * Variantes de garantia. O fixture de locação fixa UM `garantia.tipo`, então os
 * campos das outras modalidades ficam ausentes — mas as cláusulas do acervo os
 * usam legitimamente (é o mecanismo do slot). Cada tipo contribui com seus
 * campos como `condicional`.
 *
 * Os campos espelham `garantiaSchema` / `GARANTIA_TIPOS`; manter aditivo.
 */
const GARANTIA_VARIANT_FIELDS: Record<string, readonly string[]> = {
  fiador: ["fiadores", "fiador_nome", "fiador_cpf", "fiador_estado_civil", "fiador_endereco"],
  caucao: ["caucao_meses", "caucao_valor"],
  seguro_fianca: ["provider", "apolice", "seguradora", "vigencia"],
  garantia_onerosa: ["provider", "valor"],
  titulo_capitalizacao: ["provider", "titulo_numero", "titulo_valor"],
  propria: [],
  sem_garantia: [],
};

interface EsteiraCatalog {
  /** Resolve no fixture primário. */
  primary: ReadonlySet<string>;
  /** Resolve em algum fixture secundário ou variante de garantia. */
  conditional: ReadonlySet<string>;
}

let CACHE: Partial<Record<FormModule, EsteiraCatalog>> = {};

/**
 * Monta (e memoiza) o catálogo de uma esteira. Roda os enriches de verdade —
 * é caro o suficiente pra valer cache de módulo, e determinístico o bastante
 * pra que o cache seja seguro.
 */
export function buildKeyCatalog(esteira: FormModule): EsteiraCatalog {
  const cached = CACHE[esteira];
  if (cached) return cached;

  const primary = new Set<string>();
  const conditional = new Set<string>();

  const primaryFixture = ESTEIRA_PRIMARY_FIXTURE[esteira];
  for (const fixture of ESTEIRA_FIXTURES[esteira]) {
    let ctx: Record<string, unknown>;
    try {
      // `modalidade` decide a FAMÍLIA (e portanto o enrich); `fixture` decide a
      // amostra. Aqui as duas coincidem — é o contexto real de cada modalidade.
      ctx = buildTemplatePreviewContext(fixture, fixture);
    } catch {
      continue;
    }
    const target = fixture === primaryFixture ? primary : conditional;
    collectPaths(ctx, "", target);
  }

  // Variantes de garantia (só locação tem slot de garantia hoje).
  if (esteira === "locacao") {
    for (const tipo of GARANTIA_TIPOS) {
      conditional.add(`garantia.tipo`);
      for (const field of GARANTIA_VARIANT_FIELDS[tipo] ?? []) {
        conditional.add(`garantia.${field}`);
      }
    }
  }

  // Uma chave que já é `validada` não precisa constar como condicional.
  for (const p of primary) conditional.delete(p);

  const catalog: EsteiraCatalog = { primary, conditional };
  CACHE = { ...CACHE, [esteira]: catalog };
  return catalog;
}

/** Só para teste — o cache é de módulo e sobreviveria entre casos. */
export function __resetKeyCatalogCache(): void {
  CACHE = {};
}

/**
 * Um caminho é aceitável se ele mesmo, ou algum ancestral seu, está no catálogo.
 * `config.multa_rescisoria_meses` deve passar mesmo que o fixture não traga essa
 * chave específica mas traga `config` — o enrich materializa `config.*` conforme
 * o negócio, e reprovar aqui barraria cláusula legítima.
 */
function inCatalog(path: string, set: ReadonlySet<string>): boolean {
  if (set.has(path)) return true;
  const parts = path.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    if (set.has(parts.slice(0, i).join("."))) return true;
  }
  return false;
}

export function validateKey(path: string, esteira: FormModule): KeyTier {
  const { primary, conditional } = buildKeyCatalog(esteira);
  if (inCatalog(path, primary)) return "validada";
  if (inCatalog(path, conditional)) return "condicional";
  return "rejeitada";
}

/** Toda chave de um conteúdo, com seu tier. */
export function validateContentKeys(
  content: string,
  esteira: FormModule
): Array<{ path: string; tier: KeyTier }> {
  return extractHandlebarsPaths(content).map((path) => ({
    path,
    tier: validateKey(path, esteira),
  }));
}

/**
 * O conteúdo final compila e não deixa chave crua no HTML?
 *
 * Segunda rede: mesmo com todas as chaves no catálogo, um `{{#if}}` sem
 * fechamento ou um `}}` faltando derrubaria a geração. Reusa exatamente o
 * caminho do preview (`buildTemplatePreviewHtml`), que é o que a UI já chama.
 */
export function assertRendered(
  content: string,
  esteira: FormModule
): { ok: true } | { ok: false; error: string } {
  const fixture = ESTEIRA_PRIMARY_FIXTURE[esteira];
  try {
    const html = buildTemplatePreviewHtml({
      handlebarsSource: content,
      modalidade: fixture,
      fixture,
    });
    if (html.includes("{{")) {
      return { ok: false, error: "Sobrou chave não resolvida no texto renderizado." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao renderizar." };
  }
}

/**
 * Substitui um trecho literal por uma chave, SÓ quando o trecho ocorre uma
 * única vez. Mesma trava de `lib/templates/ai-placeholder-insertion.ts`:
 * ocorrência ambígua é a forma clássica de tokenizar o parágrafo errado.
 */
export function applyMapping(
  content: string,
  trecho: string,
  chave: string
): { ok: true; content: string } | { ok: false; reason: "nao_encontrado" | "ambiguo" } {
  if (!trecho) return { ok: false, reason: "nao_encontrado" };
  const first = content.indexOf(trecho);
  if (first === -1) return { ok: false, reason: "nao_encontrado" };
  if (content.indexOf(trecho, first + trecho.length) !== -1) {
    return { ok: false, reason: "ambiguo" };
  }
  return { ok: true, content: content.replace(trecho, `{{${chave}}}`) };
}
