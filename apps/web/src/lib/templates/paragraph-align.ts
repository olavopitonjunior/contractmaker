/**
 * Alinhamento parágrafo a parágrafo entre o Doc-modelo (com `{{chaves}}`) e o
 * contrato ORIGINAL que deu origem a ele (`IngestionItem.text`).
 *
 * Por que existe: a tela de revisão mostrava o relatório e as chaves, nunca a
 * cláusula. Quem revisava via "`{{rateio_primeiro_aluguel}}` inserido" e
 * decidia sem ver o que aquela chave substituiu — foi assim que uma cláusula
 * inteira colapsada numa chave solta passou por 16 revisões (03/09/2026). Lado
 * a lado, o colapso é visível: um parágrafo do Doc "vale" por três do fonte.
 *
 * PURO e seguro para o cliente (sem I/O, sem googleapis): a tela alinha o que
 * `doc-text` e `source-text` devolvem. Os dois lados são cortados pelo MESMO
 * divisor (`splitDocParagraphs`), senão `docIndex` não bate com o
 * `paragraphIndex` das checagens semânticas.
 *
 * Como alinha: subsequência comum mais longa (LCS) sobre um predicado de
 * casamento — `same` (texto igual, tolerando espaço/NBSP) ou `tokenized` (o
 * parágrafo do Doc, com cada chave trocada por um curinga, casa o parágrafo do
 * fonte). O que sobra entre dois pares casados é pareado por ordem como
 * `changed`; o excedente vira `added-in-doc` ou `missing-in-doc`. Um parágrafo
 * do Doc que é SÓ uma chave nunca casa por curinga (casaria qualquer coisa):
 * ele cai no pareamento por ordem, e é isso que faz o colapso aparecer como um
 * `changed` seguido de `missing-in-doc` — o retrato do que sumiu.
 */

export type AlignedKind =
  /** Mesmo texto nos dois lados. */
  | "same"
  /** O parágrafo do Doc casa o do fonte trocando as chaves por curinga. */
  | "tokenized"
  /** Pareados por posição, mas o texto difere além das chaves. */
  | "changed"
  /** Parágrafo do fonte sem correspondente no Doc (o retrato do colapso). */
  | "missing-in-doc"
  /** Parágrafo do Doc sem correspondente no fonte. */
  | "added-in-doc";

export interface AlignedRow {
  /** Índice em `splitDocParagraphs(docText)`, ou null em `missing-in-doc`. */
  docIndex: number | null;
  /** Índice em `splitDocParagraphs(sourceText)`, ou null em `added-in-doc`. */
  srcIndex: number | null;
  kind: AlignedKind;
  /** Chaves presentes no parágrafo do Doc (vazio quando não há parágrafo). */
  tokens: string[];
  /**
   * Em `tokenized`: o curinga casou MAIS de um parágrafo do fonte e a ordem
   * decidiu qual. A tela mostra como aproximado — a aba existe para o operador
   * conferir se a chave é a certa, e um par apresentado como certeza quando
   * havia dois candidatos mina exatamente isso.
   */
  ambiguous?: boolean;
}

export interface AlignResult {
  rows: AlignedRow[];
  /**
   * Acima de {@link ALIGN_PARAGRAPH_CAP} parágrafos de um dos lados, o LCS
   * (quadrático) dá lugar ao pareamento por posição: `same` quando igual,
   * `changed` quando não. A tela avisa que o alinhamento é aproximado.
   */
  capped: boolean;
}

/** Teto de parágrafos por lado para o alinhamento por LCS. */
export const ALIGN_PARAGRAPH_CAP = 800;

/**
 * Mínimo de caracteres LITERAIS (fora das chaves) para um parágrafo do Doc
 * poder casar o fonte por curinga. Abaixo disso o padrão é quase só curinga e
 * casaria qualquer parágrafo — inclusive o errado.
 */
const MIN_LITERAL_FOR_WILDCARD = 12;
/** Quanto uma chave pode "valer" de texto no fonte, em caracteres. */
const WILDCARD_MAX = 600;

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const TOKEN_SPLIT_RE = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/;

/**
 * Mesma régua de `normalizeForSlotMatch` (apply-clause-slot) mais NBSP→espaço
 * (doc-index): o export do Google traz NBSP onde o Word tinha espaço fixo, e
 * o texto do DOCX lido na ingestão traz espaço simples.
 */
function norm(text: string): string {
  return text.replace(/[\u00A0\u202F]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokensOf(paragraph: string): string[] {
  const out: string[] = [];
  for (const m of paragraph.matchAll(TOKEN_RE)) out.push(m[1]);
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex que casa o parágrafo do fonte a partir do parágrafo do Doc com as
 * chaves trocadas por curinga — ou null quando o parágrafo não tem chave ou
 * tem literal de menos para o casamento significar alguma coisa.
 */
function wildcardMatcher(docNorm: string): { re: RegExp; prefix: string } | null {
  const parts = docNorm.split(TOKEN_SPLIT_RE);
  if (parts.length < 2) return null;
  const literal = parts.join("").replace(/\s+/g, "").length;
  if (literal < MIN_LITERAL_FOR_WILDCARD) return null;
  // `\s*` nas bordas de cada literal: a chave pode ter absorvido o espaço
  // vizinho ("CPF {{cpf}}," vs "CPF 123," — igual — mas "{{nome}} , CPF" acontece).
  const body = parts.map((p) => escapeRegex(p.trim())).join(`\\s*[\\s\\S]{0,${WILDCARD_MAX}}?\\s*`);
  // O literal inicial é um filtro barato antes do regex: com centenas de
  // parágrafos chaveados × centenas do fonte, o regex com curinga preguiçoso
  // é o custo que domina, e a maioria dos pares nem começa igual.
  return { re: new RegExp(`^${body}$`), prefix: parts[0].trim() };
}

function byIndex(doc: string[], src: string[], docNorm: string[], srcNorm: string[]): AlignedRow[] {
  const rows: AlignedRow[] = [];
  const n = Math.max(doc.length, src.length);
  for (let i = 0; i < n; i++) {
    const hasDoc = i < doc.length;
    const hasSrc = i < src.length;
    if (hasDoc && hasSrc) {
      rows.push({
        docIndex: i,
        srcIndex: i,
        kind: docNorm[i] === srcNorm[i] ? "same" : "changed",
        tokens: tokensOf(doc[i]),
      });
    } else if (hasDoc) {
      rows.push({ docIndex: i, srcIndex: null, kind: "added-in-doc", tokens: tokensOf(doc[i]) });
    } else {
      rows.push({ docIndex: null, srcIndex: i, kind: "missing-in-doc", tokens: [] });
    }
  }
  return rows;
}

/**
 * Alinha os parágrafos do Doc-modelo com os do contrato-fonte.
 *
 * As linhas saem na ordem do documento: cada par casado no lugar em que
 * aparece, e o que ficou entre dois pares logo depois do primeiro deles.
 */
export function alignParagraphs(docParas: readonly string[], srcParas: readonly string[]): AlignResult {
  const doc = [...docParas];
  const src = [...srcParas];
  const docNorm = doc.map(norm);
  const srcNorm = src.map(norm);

  if (doc.length > ALIGN_PARAGRAPH_CAP || src.length > ALIGN_PARAGRAPH_CAP) {
    return { rows: byIndex(doc, src, docNorm, srcNorm), capped: true };
  }

  // ─── PREDICADO DE CASAMENTO ─────────────────────────────────────────────
  // `same` por tabela (O(1) por parágrafo); `tokenized` só para parágrafos do
  // Doc com chave, testando cada um contra o fonte inteiro — são poucos.
  const srcByNorm = new Map<string, number[]>();
  srcNorm.forEach((s, j) => {
    if (!s) return;
    const list = srcByNorm.get(s);
    if (list) list.push(j);
    else srcByNorm.set(s, [j]);
  });
  const same: Set<number>[] = docNorm.map((d) => new Set(d ? (srcByNorm.get(d) ?? []) : []));
  const wild: Set<number>[] = docNorm.map((d, i) => {
    const out = new Set<number>();
    if (same[i].size > 0) return out;
    const m = wildcardMatcher(d);
    if (!m) return out;
    srcNorm.forEach((s, j) => {
      if (s && s.startsWith(m.prefix) && m.re.test(s)) out.add(j);
    });
    return out;
  });
  const matches = (i: number, j: number) => same[i].has(j) || wild[i].has(j);

  // ─── LCS ─────────────────────────────────────────────────────────────────
  const n = doc.length;
  const m = src.length;
  const W = m + 1;
  const L = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = matches(i, j)
        ? L[(i + 1) * W + j + 1] + 1
        : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (matches(i, j)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  // ─── LINHAS ──────────────────────────────────────────────────────────────
  const rows: AlignedRow[] = [];
  const gap = (di0: number, di1: number, sj0: number, sj1: number) => {
    const docGap: number[] = [];
    for (let a = di0; a < di1; a++) docGap.push(a);
    const srcGap: number[] = [];
    for (let b = sj0; b < sj1; b++) srcGap.push(b);
    const k = Math.min(docGap.length, srcGap.length);
    for (let t = 0; t < k; t++) {
      rows.push({ docIndex: docGap[t], srcIndex: srcGap[t], kind: "changed", tokens: tokensOf(doc[docGap[t]]) });
    }
    for (let t = k; t < docGap.length; t++) {
      rows.push({ docIndex: docGap[t], srcIndex: null, kind: "added-in-doc", tokens: tokensOf(doc[docGap[t]]) });
    }
    for (let t = k; t < srcGap.length; t++) {
      rows.push({ docIndex: null, srcIndex: srcGap[t], kind: "missing-in-doc", tokens: [] });
    }
  };

  let pi = 0;
  let pj = 0;
  for (const [ci, cj] of pairs) {
    gap(pi, ci, pj, cj);
    const isSame = same[ci].has(cj);
    rows.push({
      docIndex: ci,
      srcIndex: cj,
      kind: isSame ? "same" : "tokenized",
      tokens: tokensOf(doc[ci]),
      ...(!isSame && wild[ci].size > 1 ? { ambiguous: true } : {}),
    });
    pi = ci + 1;
    pj = cj + 1;
  }
  gap(pi, n, pj, m);

  return { rows, capped: false };
}
