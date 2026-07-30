/**
 * Abre o SLOT no Google Doc do modelo consolidado.
 *
 * Depois que a consolidação decide "estes parágrafos são a cláusula que varia
 * entre as versões", o Doc do modelo de referência ainda os contém literalmente.
 * Aqui o primeiro parágrafo divergente vira o token `{{slot_garantia}}` e os
 * demais somem — o texto real passa a viver no acervo, uma cláusula por opção do
 * formulário, e a geração injeta a certa.
 *
 * Best-effort por design: falha aqui deixa o modelo com a cláusula fixa (o
 * comportamento de antes da consolidação), não um template quebrado. O relatório
 * devolvido alimenta a página de revisão.
 */

import { batchUpdateDoc } from "@/lib/google/docs";
import { slotToken, type ClauseSlotKey } from "./clause-slots";

/**
 * O `replaceAllText` do Docs casa TEXTO EXATO. Parágrafo curto demais casaria em
 * lugares que não são a cláusula (um "Parágrafo único." solto no documento
 * inteiro), então blocos curtos são ignorados — é melhor deixar a cláusula fixa
 * do que furar o resto do contrato.
 */
const MIN_BLOCK_CHARS = 40;

export interface ApplyClauseSlotInput {
  docId: string;
  slot: ClauseSlotKey;
  /** Parágrafos do modelo de referência que a consolidação isolou, na ordem. */
  paragraphs: string[];
}

export interface ApplyClauseSlotReport {
  slot: ClauseSlotKey;
  /** Token escrito no doc (`{{slot_garantia}}`) quando a troca aconteceu. */
  token: string | null;
  replaced: number;
  removed: number;
  skipped: number;
  error?: string;
}

export async function applyClauseSlotToDoc(
  input: ApplyClauseSlotInput
): Promise<ApplyClauseSlotReport> {
  const usable = input.paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_BLOCK_CHARS);
  const skipped = input.paragraphs.length - usable.length;
  const token = `{{${slotToken(input.slot)}}}`;

  if (usable.length === 0) {
    return { slot: input.slot, token: null, replaced: 0, removed: 0, skipped };
  }

  // O 1º parágrafo vira o token (mantém a posição e o estilo do parágrafo no
  // documento); os demais são esvaziados.
  const requests = usable.map((text, i) => ({
    replaceAllText: {
      containsText: { text, matchCase: true },
      replaceText: i === 0 ? token : "",
    },
  }));

  try {
    await batchUpdateDoc(input.docId, requests);
    return {
      slot: input.slot,
      token,
      replaced: 1,
      removed: usable.length - 1,
      skipped,
    };
  } catch (err) {
    console.error("[apply-clause-slot] batchUpdate falhou:", err);
    return {
      slot: input.slot,
      token: null,
      replaced: 0,
      removed: 0,
      skipped,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
