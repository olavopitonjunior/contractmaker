import { diffArrays } from "diff";
import { batchUpdateDoc, getDocPlainText } from "@/lib/google/docs";
import type { docs_v1 } from "googleapis";

/**
 * Reflete uma mudança de configurações contratuais no texto do Google Doc.
 *
 * ## Por que não é só "renderizar de novo"
 *
 * Depois de gerado, o Google Doc é a FONTE DE VERDADE do texto — o corretor
 * edita lá. Re-renderizar o template por cima jogaria fora todo esse trabalho.
 * Então a estratégia é cirúrgica: renderiza o contrato com os dados ANTES e
 * DEPOIS da mudança, tira o diff parágrafo-a-parágrafo e aplica só o que
 * mudou.
 *
 * ## Por que parágrafo, e por que LCS
 *
 * `replaceAllText` não atravessa quebra de parágrafo, então parágrafo é a
 * granularidade natural. E o diff precisa ser de SEQUÊNCIA (LCS), não par-a-par:
 * trocar o foro de arbitragem pra justiça comum não altera um parágrafo — troca
 * um bloco de 4 por um de 1, deslocando todo o resto.
 *
 * ## O que este módulo NÃO tenta fazer
 *
 * Parágrafo que o corretor editou à mão não casa mais com o render — aí o
 * `replace` não acha o alvo e vira `not_found` no relatório, sem mutar nada. É
 * o comportamento certo: melhor avisar do que sobrescrever o trabalho dele.
 */

export type SyncFailureReason = "not_found" | "ambiguous";

export interface DocSyncReport {
  /** Parágrafos que o diff detectou como alterados/removidos/inseridos. */
  attempted: number;
  /** Efetivamente aplicados no doc. */
  applied: number;
  failed: Array<{ reason: SyncFailureReason; text: string }>;
  /** Erro de API do Google — o dataJson é persistido mesmo assim. */
  error?: string;
}

/**
 * HTML renderizado → lista de parágrafos em texto plano, aproximando o que o
 * Google Docs guarda depois do import do MESMO HTML.
 *
 * O import do Docs decodifica entidades e colapsa whitespace, então fazemos o
 * mesmo — senão o alvo do replace nunca casaria.
 */
export function htmlToParagraphs(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, "") // slots <!-- CLAUSE_SLOT:Gx -->
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "") // tags inline (strong/em) não afetam o texto
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0);
}

/**
 * Forma canônica pra casar um parágrafo renderizado com a linha do doc.
 *
 * O Docs pode ter normalizado NBSP/espaços no import, então comparamos por uma
 * forma achatada — mas o alvo do `replaceAllText` é sempre a linha LITERAL do
 * documento (ver `syncRenderedHtmlDiffToDoc`), nunca esta.
 */
function canonical(s: string): string {
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Linhas do doc, indexadas pela forma canônica → texto literal. */
function indexDocLines(docText: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const lines = docText
    .replace(/^﻿/, "") // export text/plain vem com BOM
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const key = canonical(line);
    const bucket = map.get(key);
    if (bucket) bucket.push(line);
    else map.set(key, [line]);
  }
  return map;
}

/** Pares (antigo → novo) + inserções/remoções puras. */
export function planParagraphChanges(
  oldParas: string[],
  newParas: string[]
): {
  replacements: Array<{ before: string; after: string }>;
  insertions: string[];
  deletions: string[];
} {
  const hunks = diffArrays(oldParas, newParas);
  const replacements: Array<{ before: string; after: string }> = [];
  const insertions: string[] = [];
  const deletions: string[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    if (!h.removed && !h.added) continue;

    if (h.removed) {
      const next = hunks[i + 1];
      const removedLines = h.value;
      const addedLines = next?.added ? next.value : [];
      if (next?.added) i++; // consome o par

      // Pareia posicionalmente; o excedente de cada lado vira delete/insert.
      const pairs = Math.min(removedLines.length, addedLines.length);
      for (let j = 0; j < pairs; j++) {
        if (removedLines[j] !== addedLines[j]) {
          replacements.push({ before: removedLines[j], after: addedLines[j] });
        }
      }
      deletions.push(...removedLines.slice(pairs));
      insertions.push(...addedLines.slice(pairs));
    } else if (h.added) {
      insertions.push(...h.value);
    }
  }

  return { replacements, insertions, deletions };
}

/**
 * Aplica no doc a diferença entre dois renders do contrato.
 *
 * Escopo v1 deliberado: só REPLACE de parágrafo. Inserção/remoção pura exigem
 * `insertText`/`deleteContentRange` com índices que invalidam a cada mutação —
 * mais risco do que valor aqui. Elas entram no relatório como `not_found` pra
 * a UI mandar o usuário ao Chat IA, que sabe ancorar.
 */
export async function syncRenderedHtmlDiffToDoc(input: {
  docId: string;
  oldHtml: string;
  newHtml: string;
}): Promise<DocSyncReport> {
  const { replacements, insertions, deletions } = planParagraphChanges(
    htmlToParagraphs(input.oldHtml),
    htmlToParagraphs(input.newHtml)
  );

  const attempted = replacements.length + insertions.length + deletions.length;
  if (attempted === 0) return { attempted: 0, applied: 0, failed: [] };

  const report: DocSyncReport = { attempted, applied: 0, failed: [] };

  // Inserção/remoção de parágrafo não são aplicadas automaticamente (ver doc
  // da função) — reporta pra UI orientar.
  for (const text of [...insertions, ...deletions]) {
    report.failed.push({ reason: "not_found", text });
  }

  if (replacements.length === 0) return report;

  let docIndex: Map<string, string[]>;
  try {
    docIndex = indexDocLines(await getDocPlainText(input.docId));
  } catch (err) {
    return {
      ...report,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const requests: docs_v1.Schema$Request[] = [];
  for (const r of replacements) {
    const matches = docIndex.get(canonical(r.before));
    if (!matches || matches.length === 0) {
      // Parágrafo editado à mão no doc (ou nunca renderizado assim).
      report.failed.push({ reason: "not_found", text: r.before });
      continue;
    }
    if (matches.length > 1) {
      // Mesma regra do googleEditSection: alvo ambíguo não muta nada, senão a
      // edição vaza pra cláusula errada (replaceAllText troca TODAS).
      report.failed.push({ reason: "ambiguous", text: r.before });
      continue;
    }
    requests.push({
      replaceAllText: {
        containsText: { text: matches[0], matchCase: true },
        replaceText: r.after,
      },
    });
  }

  if (requests.length === 0) return report;

  try {
    // Um único batch: `replaceAllText` é index-free, então não há invalidação
    // entre requests.
    const res = await batchUpdateDoc(input.docId, requests);
    const replies = res.data.replies ?? [];
    report.applied = replies.reduce(
      (acc, rep) => acc + (rep.replaceAllText?.occurrencesChanged ?? 0),
      0
    );
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
  }

  return report;
}
