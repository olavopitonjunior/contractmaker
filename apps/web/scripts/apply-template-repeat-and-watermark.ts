/**
 * Polimento programático dos templates Google Docs:
 *
 *  1. Insere `[[WATERMARK_MINUTA]]` no topo do doc (será removido na aprovação).
 *  2. Envolve os blocos de qualificação com markers `[[REPEAT:NAME]]...[[/REPEAT]]`
 *     e troca `<entity>1.X` por `<entity>I.X` dentro deles, exceto no parágrafo
 *     da capa onde `vendedores1` / `compradores1` / `imoveis1` ficam fixos.
 *
 * Uso:
 *   npx ts-node scripts/apply-template-repeat-and-watermark.ts \
 *     --templateDocId=<id>
 *
 * Idempotente: detecta se já tem watermark / REPEAT e pula.
 */

import fs from "fs";
import path from "path";
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*'?([^']*)'?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}

import { batchUpdateDoc, getDocStructure } from "../src/lib/google/docs";
import type { docs_v1 } from "googleapis";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

interface BlockSpec {
  /** Nome do array (vendedores, compradores, imoveis). */
  name: string;
  /** Texto âncora que marca o INÍCIO do bloco (linha logo antes da qual o REPEAT entra). */
  startAnchor: string;
  /** Texto âncora que marca o FIM do bloco (linha cujo final demarca o /REPEAT). */
  endAnchor: string;
}

const A_VISTA_BLOCKS: BlockSpec[] = [
  // O bloco do vendedor inclui da linha "Promitente Vendedor" até o último
  // parágrafo do "procurador" antes do próximo header (PARTE COMPRADORA).
  { name: "vendedores", startAnchor: "Promitente Vendedor", endAnchor: "PARTE COMPRADORA" },
  // Bloco comprador idem, até INTERMEDIADORA.
  { name: "compradores", startAnchor: "Promissário(a) Comprador(a)", endAnchor: "INTERMEDIADORA" },
  // Bloco imóvel: parágrafo de descrição na CLÁUSULA PRIMEIRA.
  // Começa em "Endereço: {{imoveis1.rua}}" e termina antes de "1.1.1." ou "CLÁUSULA SEGUNDA"
  { name: "imoveis", startAnchor: "Endereço: {{imoveis1.rua}}", endAnchor: "1.1.1." },
];

const FINANCIAMENTO_BLOCKS: BlockSpec[] = [
  { name: "vendedores", startAnchor: "Promitente Vendedor", endAnchor: "PARTE COMPRADORA" },
  { name: "compradores", startAnchor: "Promissário(a) Comprador(a)", endAnchor: "INTERMEDIADORA" },
  // Financiamento não tem "1.1.1." — usa "CLÁUSULA SEGUNDA" como fim
  { name: "imoveis", startAnchor: "Endereço: {{imoveis1.rua}}", endAnchor: "CLÁUSULA SEGUNDA" },
];

async function main() {
  const docId = arg("templateDocId");
  if (!docId) {
    console.error("Uso: --templateDocId=<id>");
    process.exit(1);
  }

  console.log(`Polindo template ${docId}…`);

  // 1. Insere watermark no topo se ainda não existir
  const docInitial = await getDocStructure(docId);
  const fullText = docToPlainText(docInitial);
  const hasWatermark = fullText.includes("[[WATERMARK_MINUTA]]");
  if (!hasWatermark) {
    // Insere texto + estilo no índice 1 (topo do body, depois da seção introdutória)
    const watermarkText = "[[WATERMARK_MINUTA]]\n";
    await batchUpdateDoc(docId, [
      {
        insertText: {
          text: watermarkText,
          location: { index: 1 },
        },
      },
      {
        updateTextStyle: {
          range: { startIndex: 1, endIndex: 1 + watermarkText.length - 1 },
          textStyle: {
            fontSize: { magnitude: 96, unit: "PT" },
            italic: true,
            foregroundColor: {
              color: { rgbColor: { red: 0.85, green: 0.85, blue: 0.85 } },
            },
          },
          fields: "fontSize,italic,foregroundColor",
        },
      },
      {
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 1 + watermarkText.length - 1 },
          paragraphStyle: { alignment: "CENTER" },
          fields: "alignment",
        },
      },
    ]);
    console.log("✓ Watermark inserido");
  } else {
    console.log("• Watermark já presente — pulo");
  }

  // 2. Decide o set de blocos baseado em qual âncora de fim de imóvel existe.
  // Re-busca após watermark insertion (índices mudam mas plain text inalterado).
  const docAfterWm = await getDocStructure(docId);
  const fullTextAfter = docToPlainText(docAfterWm);
  const useFinanciamento = !fullTextAfter.includes("1.1.1.");
  const blocks = useFinanciamento ? FINANCIAMENTO_BLOCKS : A_VISTA_BLOCKS;
  console.log(`Detected template kind: ${useFinanciamento ? "financiamento" : "à vista"}`);

  for (const block of blocks) {
    await applyRepeatBlock(docId, block);
  }
}

async function applyRepeatBlock(docId: string, spec: BlockSpec): Promise<void> {
  const doc = await getDocStructure(docId);
  const fullText = docToPlainText(doc);

  // Idempotência
  if (fullText.includes(`[[REPEAT:${spec.name}]]`)) {
    console.log(`• REPEAT:${spec.name} já presente — pulo`);
    return;
  }

  // Localiza âncoras
  const startIdx = fullText.indexOf(spec.startAnchor);
  if (startIdx < 0) {
    console.warn(`! ${spec.name}: âncora de início não encontrada: "${spec.startAnchor}"`);
    return;
  }
  const endIdx = fullText.indexOf(spec.endAnchor, startIdx);
  if (endIdx < 0) {
    console.warn(`! ${spec.name}: âncora de fim não encontrada: "${spec.endAnchor}"`);
    return;
  }

  // O REPEAT vai do início da linha que tem startAnchor até o início da linha que tem endAnchor.
  // Para isolar a linha, voltamos para o último \n antes do startAnchor e até o último \n antes de endAnchor.
  const blockStart = fullText.lastIndexOf("\n", startIdx) + 1;
  const blockEnd = fullText.lastIndexOf("\n", endIdx);
  if (blockEnd <= blockStart) {
    console.warn(`! ${spec.name}: range inválido`);
    return;
  }

  const innerText = fullText.slice(blockStart, blockEnd);
  // Troca <entity>1. por <entity>I. APENAS DENTRO do bloco
  const newInnerText = innerText.replace(
    new RegExp(`\\{\\{${spec.name}1\\.`, "g"),
    `{{${spec.name}I.`
  );

  // Mapeia char index → docs API index
  const segments = collectSegments(doc);
  const docsBlockStart = charToDocs(segments, blockStart);
  const docsBlockEnd = charToDocs(segments, blockEnd);

  const wrappedText = `[[REPEAT:${spec.name}]]\n${newInnerText}\n[[/REPEAT]]\n`;

  // Substitui: delete + insert
  await batchUpdateDoc(docId, [
    {
      deleteContentRange: {
        range: { startIndex: docsBlockStart, endIndex: docsBlockEnd },
      },
    },
    {
      insertText: {
        text: wrappedText,
        location: { index: docsBlockStart },
      },
    },
  ]);

  console.log(
    `✓ REPEAT:${spec.name} aplicado (bloco com ${innerText.length} chars, ${(innerText.match(new RegExp(`${spec.name}1\\.`, "g")) || []).length} placeholders trocados)`
  );
}

interface Segment { text: string; startIndex: number }

function collectSegments(doc: docs_v1.Schema$Document): Segment[] {
  const out: Segment[] = [];
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    for (const el of para.elements || []) {
      const tr = el.textRun;
      if (!tr || !tr.content) continue;
      if (el.startIndex === undefined || el.startIndex === null) continue;
      out.push({ text: tr.content, startIndex: el.startIndex });
    }
  }
  return out;
}

function docToPlainText(doc: docs_v1.Schema$Document): string {
  return collectSegments(doc).map((s) => s.text).join("");
}

function charToDocs(segments: Segment[], charIdx: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = s.text.length;
    if (charIdx <= acc + len) {
      return s.startIndex + (charIdx - acc);
    }
    acc += len;
  }
  const last = segments[segments.length - 1];
  return last ? last.startIndex + last.text.length : 1;
}

main().catch((e) => {
  console.error("Erro:", e);
  process.exit(1);
});
