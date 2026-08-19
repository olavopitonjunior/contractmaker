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
 * 3. CONFERIR O RESULTADO, não presumi-lo. As guardas acima rodam contra o
 *    texto PLANO (`getDocPlainText`, que concatena os `textRun`), mas quem
 *    aplica é o `replaceAllText`, que casa contra a estrutura real do Doc. Um
 *    parágrafo partido em vários runs (herança comum de DOCX com formatação
 *    invisível) satisfaz a guarda e muda ZERO ocorrências — foi assim que dois
 *    modelos da RE/MAX Trio foram declarados com slot que não existia no Doc,
 *    e todo contrato saía com a garantia da variante de referência chumbada.
 *    Por isso o retorno do batch é inspecionado (`occurrencesChanged`) e o doc
 *    é RELIDO: `applied: true` só sai quando o token está no documento e nenhum
 *    parágrafo do bloco sobrou.
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
  | "batch-failed"
  /** O `replaceAllText` casou 0 ocorrências — o texto plano mentiu (ver trava 3). */
  | "replace-noop"
  /**
   * O `replaceAllText` casou MAIS de uma vez. A guarda de unicidade roda contra
   * o texto plano, que não inclui cabeçalho/rodapé — mas o replace casa contra
   * a estrutura inteira do Doc. Editamos um lugar que ninguém examinou.
   */
  | "over-matched"
  /** O batch reportou sucesso, mas a releitura do doc CONTRADIZ o resultado. */
  | "verify-failed"
  /**
   * Não deu pra conferir (Drive fora do ar, 429, credencial). Diferente de
   * `verify-failed`: ali sabemos que deu errado, aqui não sabemos nada — e
   * "não sei" nunca pode ser tratado como "deu certo".
   */
  | "verify-unavailable"
  /** O token não está mais no Doc (detectado na revalidação, não na ingestão). */
  | "token-missing";

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

  let replies: Array<{ replaceAllText?: { occurrencesChanged?: number | null } }>;
  try {
    const res = await batchUpdateDoc(input.docId, requests);
    replies = res?.data?.replies ?? [];
  } catch (err) {
    console.error("[apply-clause-slot] batchUpdate falhou:", err);
    return fail([issue(blocks[0], "batch-failed")]);
  }

  // A API omite o campo quando o valor é 0 (default de protobuf), então
  // `undefined` aqui significa "nenhuma ocorrência trocada", não "não sei".
  // Reply ausente (lista mais curta que os requests) fica pro verify abaixo.
  const counted: SlotBlockIssue[] = [];
  blocks.forEach((b, i) => {
    if (i >= replies.length) return; // reply ausente fica pro verify abaixo
    const changed = replies[i]?.replaceAllText?.occurrencesChanged ?? 0;
    if (changed === 0) counted.push(issue(b, "replace-noop"));
    // Casou em lugar que a guarda de unicidade não examinou (cabeçalho/rodapé
    // não entram no texto plano). Editar ali é tão ruim quanto não editar.
    else if (changed > 1) counted.push(issue(b, "over-matched"));
  });
  if (counted.length > 0) return fail(counted);

  // Releitura: o contador acima não pega tudo (reply ausente, edição
  // concorrente). O estado final do documento pega.
  let finalText: string;
  try {
    finalText = await getDocPlainText(input.docId);
  } catch (err) {
    console.error("[apply-clause-slot] não consegui reler o doc:", err);
    return fail([issue(blocks[0], "verify-unavailable")]);
  }
  if (!finalText.includes(token)) {
    return fail([issue(blocks[0], "verify-failed")]);
  }
  const leftover = blocks.filter((b) => finalText.includes(b));
  if (leftover.length > 0) {
    return fail(leftover.map((b) => issue(b, "verify-failed")));
  }

  return {
    slot: input.slot,
    applied: true,
    token,
    removed: blocks.length - 1,
    issues: [],
  };
}
