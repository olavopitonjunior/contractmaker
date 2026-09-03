/**
 * Ponte entre o texto PLANO de um Google Doc e os índices absolutos da Docs API.
 *
 * Toda edição estrutural (`deleteContentRange`, `insertText`) fala em índices
 * absolutos do documento, não em texto. Quem tem o texto — as travas de
 * unicidade, as checagens semânticas, o operador que selecionou um trecho —
 * precisa traduzir "este parágrafo" para "do índice X ao Y".
 *
 * Estas funções viviam privadas em `lib/google/loops.ts`, que as usa para achar
 * `[[REPEAT]]`. Saíram para cá quando ganharam um segundo caso: restaurar um
 * parágrafo que uma chave engoliu, que é estrutural por necessidade —
 * `replaceAllText` NÃO cria parágrafo (o `\n` no texto de troca não é
 * documentado como quebra), então devolver várias linhas exige apagar o
 * intervalo e inserir texto novo.
 */
import type { docs_v1 } from "googleapis";

export interface TextSegment {
  text: string;
  /** Índice absoluto da Docs API onde este segmento começa. */
  docsStartIndex: number;
}

/** Os `textRun` do corpo, em ordem, com o índice de origem de cada um. */
export function collectTextSegments(doc: docs_v1.Schema$Document): TextSegment[] {
  const out: TextSegment[] = [];
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    for (const el of para.elements || []) {
      const tr = el.textRun;
      if (!tr || !tr.content) continue;
      if (el.startIndex === undefined || el.startIndex === null) continue;
      out.push({ text: tr.content, docsStartIndex: el.startIndex });
    }
  }
  return out;
}

/** Índice de caractere no texto plano → índice absoluto da Docs API. */
export function charToDocsIndex(segments: TextSegment[], charIdx: number): number {
  let acc = 0;
  for (const seg of segments) {
    const len = seg.text.length;
    if (charIdx <= acc + len) {
      const offset = charIdx - acc;
      return seg.docsStartIndex + offset;
    }
    acc += len;
  }
  // Char index além do texto coletado: fim do último segmento.
  const last = segments[segments.length - 1];
  return last ? last.docsStartIndex + last.text.length : 1;
}

/** O texto plano que os segmentos formam (é o que os índices indexam). */
export function plainTextOf(segments: readonly TextSegment[]): string {
  return segments.map((s) => s.text).join("");
}

export interface ParagraphRange {
  /** Índice absoluto do primeiro caractere do parágrafo. */
  startIndex: number;
  /** Índice absoluto DEPOIS do último caractere, sem incluir a marca de parágrafo. */
  endIndex: number;
}

/**
 * Intervalo do parágrafo cujo texto, aparado, é exatamente `text`.
 *
 * Devolve `null` quando não existe ou quando aparece em MAIS de um parágrafo:
 * apagar um intervalo é destrutivo e ambiguidade aqui não pode virar escolha
 * arbitrária. A marca de parágrafo fica FORA do intervalo de propósito — quem
 * insere o texto novo no lugar herda a formatação do parágrafo, em vez de
 * fundir-se com o seguinte.
 */
/** Parágrafos do corpo, com o intervalo de cada um. */
function paragraphsOf(doc: docs_v1.Schema$Document): Array<{ texto: string; range: ParagraphRange }> {
  const out: Array<{ texto: string; range: ParagraphRange }> = [];
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    const elements = (para.elements || []).filter(
      (el) => el.textRun?.content && el.startIndex !== undefined && el.startIndex !== null
    );
    if (elements.length === 0) continue;
    const conteudo = elements.map((el) => el.textRun!.content!).join("");
    const start = elements[0]!.startIndex!;
    const semNewline = conteudo.replace(/\n+$/, "").length;
    out.push({
      texto: conteudo.replace(/\n+$/, "").trim(),
      range: { startIndex: start, endIndex: start + semNewline },
    });
  }
  return out;
}

/**
 * Intervalo que cobre uma sequência CONSECUTIVA de parágrafos, do início do
 * primeiro ao fim do último.
 *
 * Exigir que sejam consecutivos não é detalhe: sem isso, três parágrafos
 * espalhados pelo documento produziriam um intervalo que engole tudo que está
 * entre eles — e o que está entre eles é contrato. Ambíguo (a mesma sequência
 * aparece duas vezes) devolve `null` pelo mesmo motivo de sempre: apagar
 * intervalo é destrutivo, e escolher um dos dois seria arbitrário.
 */
export function findBlockRange(
  doc: docs_v1.Schema$Document,
  textos: readonly string[]
): ParagraphRange | null {
  const alvos = textos.map((t) => t.trim()).filter(Boolean);
  if (alvos.length === 0) return null;

  const paras = paragraphsOf(doc);
  let achado: ParagraphRange | null = null;
  for (let i = 0; i + alvos.length <= paras.length; i += 1) {
    const casa = alvos.every((t, k) => paras[i + k]!.texto === t);
    if (!casa) continue;
    if (achado) return null; // a mesma sequência aparece mais de uma vez
    achado = {
      startIndex: paras[i]!.range.startIndex,
      endIndex: paras[i + alvos.length - 1]!.range.endIndex,
    };
  }
  return achado;
}

export function findParagraphRange(
  doc: docs_v1.Schema$Document,
  text: string
): ParagraphRange | null {
  const alvo = text.trim();
  if (!alvo) return null;

  let found: ParagraphRange | null = null;
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    const elements = (para.elements || []).filter(
      (el) => el.textRun?.content && el.startIndex !== undefined && el.startIndex !== null
    );
    if (elements.length === 0) continue;

    const conteudo = elements.map((el) => el.textRun!.content!).join("");
    if (conteudo.replace(/\n+$/, "").trim() !== alvo) continue;
    if (found) return null; // ambíguo: dois parágrafos com o mesmo texto

    const start = elements[0]!.startIndex!;
    // Sem a marca de parágrafo: o `\n` final do último run é o que separa este
    // parágrafo do próximo, e apagá-lo funde os dois.
    const semNewline = conteudo.replace(/\n+$/, "").length;
    found = { startIndex: start, endIndex: start + semNewline };
  }
  return found;
}
