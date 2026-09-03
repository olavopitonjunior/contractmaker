import { batchUpdateDoc, getDocStructure } from "./docs";
import type { docs_v1 } from "googleapis";
// Os utilitários de índice moram em `doc-index.ts` desde que ganharam um
// segundo caso (restaurar parágrafo engolido por uma chave).
import { charToDocsIndex, collectTextSegments } from "./doc-index";

/**
 * Expande blocos `[[REPEAT:fieldName]]...[[/REPEAT]]` no doc para N iterações
 * baseado em `dataJson[fieldName]` (que precisa ser array). Dentro do bloco,
 * substitui `I` literal pelo índice (1-based). Exemplo:
 *
 *   Template:
 *     [[REPEAT:vendedores]]
 *     Vendedor: {{vendedoresI.nome}}, CPF {{vendedoresI.cpf_fmt}}
 *     [[/REPEAT]]
 *
 *   Com dataJson.vendedores = [{nome:'A'}, {nome:'B'}]:
 *     Vendedor: {{vendedores1.nome}}, CPF {{vendedores1.cpf_fmt}}
 *     Vendedor: {{vendedores2.nome}}, CPF {{vendedores2.cpf_fmt}}
 *
 * As substituições finais ({{vendedores1.nome}} → "A") rodam DEPOIS via
 * replaceAllText em createDocFromTemplate, usando flattenForGoogleDoc.
 *
 * Limitações:
 *  - Não suporta loops aninhados.
 *  - O bloco é detectado por busca de texto plano; ordem dos markers no doc
 *    define ordem de processamento. Cada par é processado uma vez por chamada.
 */
export async function expandLoops(
  docId: string,
  dataJson: Record<string, unknown>
): Promise<{ blocksExpanded: number; itemsTotal: number }> {
  let blocksExpanded = 0;
  let itemsTotal = 0;

  // Loop até estabilizar — cada iteração processa o primeiro REPEAT encontrado
  // e some/cria os índices, depois repete até não haver mais REPEAT.
  let safety = 50;
  while (safety-- > 0) {
    const doc = await getDocStructure(docId);
    const block = findFirstRepeatBlock(doc);
    if (!block) break;

    const arr = dataJson[block.fieldName];
    const items = Array.isArray(arr) ? arr : [];
    const N = items.length;

    if (N === 0) {
      // Remove o bloco inteiro inclusive markers
      await batchUpdateDoc(docId, [
        {
          deleteContentRange: {
            range: { startIndex: block.startIndex, endIndex: block.endIndex },
          },
        },
      ]);
    } else {
      // Substitui o bloco (incluindo os markers) por N cópias do innerText com I→idx.
      const innerText = block.innerText;
      const expanded = Array.from({ length: N }, (_, i) => {
        const idx = i + 1;
        return replaceLoopIndex(innerText, idx);
      }).join("\n");

      await batchUpdateDoc(docId, [
        {
          deleteContentRange: {
            range: { startIndex: block.startIndex, endIndex: block.endIndex },
          },
        },
        {
          insertText: {
            text: expanded,
            location: { index: block.startIndex },
          },
        },
      ]);
      itemsTotal += N;
    }
    blocksExpanded++;
  }

  return { blocksExpanded, itemsTotal };
}

interface RepeatBlock {
  fieldName: string;
  startIndex: number; // início do `[[REPEAT:...]]`
  endIndex: number; // fim do `[[/REPEAT]]\n`
  innerText: string; // texto entre os marcadores (sem markers, com `I` literal)
}

/**
 * Varre o doc procurando o PRIMEIRO `[[REPEAT:NAME]]...[[/REPEAT]]`. Retorna
 * os índices absolutos (Docs API) de início e fim, e o texto interno.
 */
function findFirstRepeatBlock(doc: docs_v1.Schema$Document): RepeatBlock | null {
  // Reconstrói texto plano com ranges para mapear caracteres → índices Docs.
  const segments = collectTextSegments(doc);
  const fullText = segments.map((s) => s.text).join("");

  const startMatch = fullText.match(/\[\[REPEAT:(\w+)\]\]/);
  if (!startMatch || startMatch.index === undefined) return null;

  const fieldName = startMatch[1];
  const startCharIdx = startMatch.index;
  const endMarkerIdx = fullText.indexOf("[[/REPEAT]]", startCharIdx);
  if (endMarkerIdx < 0) {
    console.warn(`[expandLoops] [[REPEAT:${fieldName}]] sem fechamento [[/REPEAT]]`);
    return null;
  }

  const startMarkerLen = startMatch[0].length;
  const endMarkerLen = "[[/REPEAT]]".length;

  // Inner text: tudo entre fim do start marker e início do end marker.
  // Trim newline imediato após start e antes de end pra evitar linhas vazias acumuladas.
  let innerStart = startCharIdx + startMarkerLen;
  let innerEnd = endMarkerIdx;
  if (fullText[innerStart] === "\n") innerStart++;
  if (fullText[innerEnd - 1] === "\n") innerEnd--;
  const innerText = fullText.slice(innerStart, innerEnd);

  // Mapeia char index → docs API index
  const startIndex = charToDocsIndex(segments, startCharIdx);
  let endIndex = charToDocsIndex(segments, endMarkerIdx + endMarkerLen);
  // Inclui newline final se existir, pra não deixar linha em branco.
  if (fullText[endMarkerIdx + endMarkerLen] === "\n") {
    endIndex = charToDocsIndex(segments, endMarkerIdx + endMarkerLen + 1);
  }

  return { fieldName, startIndex, endIndex, innerText };
}

/**
 * Substitui `I` literal por `idx` apenas dentro de placeholders `{{...I...}}`
 * para evitar trocar palavras como "Inscrição" inadvertidamente.
 */
function replaceLoopIndex(template: string, idx: number): string {
  return template.replace(/\{\{([^{}]*)\}\}/g, (full, content: string) => {
    const replaced = content.replace(/I/g, String(idx));
    return `{{${replaced}}}`;
  });
}
