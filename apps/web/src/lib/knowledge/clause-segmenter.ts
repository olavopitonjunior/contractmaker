/**
 * Segmentação determinística de um documento em cláusulas.
 *
 * Usada pela ingestão da base de conhecimento quando o classificador conclui
 * que o arquivo é uma COLEÇÃO de cláusulas soltas: em vez de picar o texto por
 * TAMANHO (`lib/ai/chunking.ts`, ~800 tokens com overlap), cada cláusula vira
 * um `KnowledgeItem category="clause"` inteiro — que é a unidade que o agente
 * insere/remove no contrato.
 *
 * Sem IA: só regex sobre cabeçalhos. Padrões calibrados nos templates reais do
 * repo ("CLÁUSULA PRIMEIRA - DO OBJETO", "CLÁUSULA 1ª — DO OBJETO",
 * "CLÁUSULA DÉCIMA SEGUNDA - DA LGPD") mais numeração de lista ("1.", "2.1").
 */

export interface ClauseSegment {
  title: string;
  content: string;
}

/** Título é rótulo de UI/RAG — cortado pra não virar parágrafo. */
const MAX_TITLE_CHARS = 120;
/** Segmento curto demais é ruído de OCR/quebra, não cláusula. */
const MIN_SEGMENT_CHARS = 25;
/** Abaixo disso não é "coleção" — deixa o chunking por tamanho cuidar. */
const MIN_SEGMENTS = 2;

/** "CLÁUSULA PRIMEIRA - ...", "CLÁUSULA 1ª — ...", "Cláusula adicional ..." */
const CLAUSE_KEYWORD_HEADER = /^\s{0,8}CL[ÁA]USULA\b/i;

/** Numeração multinível no início da linha: "2.1 ...", "1.2.3. ..." */
const NUMBERED_MULTI_HEADER = /^\s{0,8}\d{1,2}(?:\.\d{1,2}){1,3}\s?[.)\-–—]?\s+\S/;

/** Numeração de topo: exige separador ("1. DO OBJETO", "1 - DO OBJETO"), senão
 *  qualquer frase que comece com número ("10 dias corridos...") viraria título. */
const NUMBERED_TOP_HEADER = /^\s{0,8}\d{1,2}\s?[.)\-–—]\s+\S/;

function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function isClauseKeywordHeader(line: string): boolean {
  return CLAUSE_KEYWORD_HEADER.test(line);
}

function isNumberedTopHeader(line: string): boolean {
  return NUMBERED_TOP_HEADER.test(line);
}

function isAnyNumberedHeader(line: string): boolean {
  return NUMBERED_TOP_HEADER.test(line) || NUMBERED_MULTI_HEADER.test(line);
}

function headerIndices(
  lines: string[],
  predicate: (line: string) => boolean
): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() && predicate(lines[i])) out.push(i);
  }
  return out;
}

/**
 * Escolhe a estratégia de cabeçalho com mais sinal, na ordem: palavra-chave
 * "CLÁUSULA" → numeração de topo ("1.") → qualquer numeração ("2.1"). A ordem
 * importa: num doc com "CLÁUSULA PRIMEIRA" + subitens "1.1", a palavra-chave
 * ganha e os subitens ficam DENTRO da cláusula (que é a unidade correta).
 */
function detectHeaders(lines: string[]): number[] {
  const byKeyword = headerIndices(lines, isClauseKeywordHeader);
  if (byKeyword.length >= MIN_SEGMENTS) return byKeyword;
  const byTopNumber = headerIndices(lines, isNumberedTopHeader);
  if (byTopNumber.length >= MIN_SEGMENTS) return byTopNumber;
  const byAnyNumber = headerIndices(lines, isAnyNumberedHeader);
  if (byAnyNumber.length >= MIN_SEGMENTS) return byAnyNumber;
  return [];
}

/** Título = a linha do cabeçalho, normalizada e truncada em palavra íntegra. */
function deriveTitle(headerLine: string): string {
  const clean = headerLine
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.:;,\s–—-]+$/, "")
    .trim();
  if (clean.length <= MAX_TITLE_CHARS) return clean;
  const cut = clean.slice(0, MAX_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > MAX_TITLE_CHARS * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base.trim()}…`;
}

/**
 * Quebra o texto em cláusulas. Devolve `[]` quando o documento não parece uma
 * coleção (menos de 2 cabeçalhos, ou segmentos curtos demais) — nesse caso o
 * chamador deve manter o chunking por tamanho.
 *
 * O conteúdo de cada segmento INCLUI a linha do cabeçalho: a cláusula precisa
 * ser autossuficiente quando o agente a insere no contrato.
 */
export function segmentClauses(text: string): ClauseSegment[] {
  const lines = normalize(text).split("\n");
  const headers = detectHeaders(lines);
  if (headers.length < MIN_SEGMENTS) return [];

  const segments: ClauseSegment[] = [];
  for (let h = 0; h < headers.length; h++) {
    const start = headers[h];
    const end = h + 1 < headers.length ? headers[h + 1] : lines.length;
    const block = lines.slice(start, end).join("\n").trim();
    if (block.length < MIN_SEGMENT_CHARS) continue;
    segments.push({ title: deriveTitle(lines[start]), content: block });
  }

  return segments.length >= MIN_SEGMENTS ? segments : [];
}

/**
 * Quantos cabeçalhos de cláusula o documento tem, pela mesma estratégia da
 * segmentação. O classificador usa isso como sinal estrutural — mantém uma
 * única definição de "cabeçalho de cláusula" no código.
 */
export function countClauseHeaders(text: string): number {
  return detectHeaders(normalize(text).split("\n")).length;
}
