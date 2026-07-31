/**
 * Abre o SLOT no Google Doc do modelo consolidado.
 *
 * Depois que a consolidação decide "estes parágrafos são a cláusula que varia
 * entre as versões", o Doc do modelo de referência ainda os contém literalmente.
 * Aqui o primeiro parágrafo divergente vira o token `{{slot_garantia}}` e os
 * demais somem — o texto real passa a viver no acervo, uma cláusula por opção do
 * formulário, e a geração injeta a certa.
 *
 * DUAS TRAVAS, porque o custo do erro é um contrato assinado com a garantia
 * errada:
 *
 * 1. `countOccurrences === 1` por parágrafo (a mesma guarda determinística que
 *    `insertPlaceholdersWithAI` e `map-field` já usam). `replaceAllText` é
 *    GLOBAL: um parágrafo repetido no doc (resumo executivo, anexo, índice)
 *    seria substituído/apagado em TODAS as ocorrências.
 * 2. TUDO OU NADA. Se qualquer parágrafo do bloco falha a guarda, NADA é
 *    aplicado. Aplicar só uma parte deixaria o doc com o token E o resto do
 *    texto antigo — o contrato sairia com duas garantias. Sem aplicação, o
 *    modelo fica com a cláusula fixa (o comportamento pré-consolidação), o slot
 *    NÃO é declarado (`from-docx`) e a página de revisão avisa antes de ativar.
 *
 * Erro de rede não lança: devolve `applied: false` e quem chama decide. O que
 * nunca pode acontecer é declarar um slot que não existe no documento.
 */

import { batchUpdateDoc, getDocPlainText } from "@/lib/google/docs";
import { slotToken, type ClauseSlotKey } from "./clause-slots";

/**
 * Parágrafo curto demais casaria em lugares que não são a cláusula (um
 * "Parágrafo único." solto no documento inteiro). Abaixo disso nem tentamos.
 */
export const MIN_SLOT_BLOCK_CHARS = 40;

export type SlotBlockIssueReason =
  | "too-short"
  | "not-found"
  | "ambiguous"
  | "doc-unreadable"
  | "batch-failed";

export interface SlotBlockIssue {
  /** Trecho problemático, truncado pra caber no relatório. */
  paragraph: string;
  reason: SlotBlockIssueReason;
}

export interface ApplyClauseSlotInput {
  docId: string;
  slot: ClauseSlotKey;
  /** Parágrafos do modelo de referência que a consolidação isolou, na ordem. */
  paragraphs: string[];
}

export interface ApplyClauseSlotReport {
  slot: ClauseSlotKey;
  /** true só quando o bloco INTEIRO saiu do doc e o token entrou. */
  applied: boolean;
  /** Token escrito no doc (`{{slot_garantia}}`) — null quando não aplicou. */
  token: string | null;
  /** Parágrafos esvaziados (o bloco menos o que virou token). */
  removed: number;
  issues: SlotBlockIssue[];
}

/** Ocorrências exatas de `needle` em `haystack` (mesma função do pass de IA). */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return count;
}

function issue(paragraph: string, reason: SlotBlockIssueReason): SlotBlockIssue {
  return { paragraph: paragraph.slice(0, 200), reason };
}

export async function applyClauseSlotToDoc(
  input: ApplyClauseSlotInput
): Promise<ApplyClauseSlotReport> {
  const blocks = input.paragraphs.map((p) => p.trim()).filter(Boolean);
  const token = `{{${slotToken(input.slot)}}}`;
  const fail = (issues: SlotBlockIssue[]): ApplyClauseSlotReport => ({
    slot: input.slot,
    applied: false,
    token: null,
    removed: 0,
    issues,
  });

  if (blocks.length === 0) return fail([]);

  let docText: string;
  try {
    docText = await getDocPlainText(input.docId);
  } catch (err) {
    console.error("[apply-clause-slot] não consegui ler o doc:", err);
    return fail([issue(blocks[0], "doc-unreadable")]);
  }

  const issues: SlotBlockIssue[] = [];
  for (const block of blocks) {
    if (block.length < MIN_SLOT_BLOCK_CHARS) {
      issues.push(issue(block, "too-short"));
      continue;
    }
    const count = countOccurrences(docText, block);
    if (count === 0) issues.push(issue(block, "not-found"));
    else if (count > 1) issues.push(issue(block, "ambiguous"));
  }

  // Tudo ou nada — ver a trava 2 no comentário do topo.
  if (issues.length > 0) return fail(issues);

  const requests = blocks.map((text, i) => ({
    replaceAllText: {
      containsText: { text, matchCase: true },
      replaceText: i === 0 ? token : "",
    },
  }));

  try {
    await batchUpdateDoc(input.docId, requests);
  } catch (err) {
    console.error("[apply-clause-slot] batchUpdate falhou:", err);
    return fail([issue(blocks[0], "batch-failed")]);
  }

  return {
    slot: input.slot,
    applied: true,
    token,
    removed: blocks.length - 1,
    issues: [],
  };
}
