/**
 * Remove o watermark `[[WATERMARK_MINUTA]]` (e o parágrafo enorme em branco que
 * o approve/route.ts deixava após `replaceAllText`) de um Google Doc.
 *
 * Uso:
 *   npx ts-node apps/web/scripts/strip-watermark.ts --docId=<doc-id>
 *
 * Aplica a heurística:
 *   1. Procura parágrafo cujo texto ENTIRE é "[[WATERMARK_MINUTA]]" (com
 *      possíveis whitespaces ao redor) — deleta o parágrafo inteiro.
 *   2. Se não achar o token, procura parágrafo no início do doc com fontSize
 *      ≥48pt + alignment=CENTER + texto vazio ou só whitespace — assume que é
 *      um restinho de watermark já texturalmente removido pelo approve, deleta.
 *
 * Idempotente: se nenhum dos casos bate, sai sem mudar nada.
 *
 * Aplicar nos 2 templates Google Docs e no contrato fixture do QA:
 *   --docId=1oajGsfWSmjZKGWTKQ7vzVVkafxzR0M6G0PSyO03nBHk  (CCV À Vista)
 *   --docId=1hYZDXG1FYkVXNdh7l5qllUw1maeT13L7_KPnqfITGfE  (CCV Financiamento)
 *   --docId=1xOxWjyB3Dmk4YsFqCCGVsLndjIplX3hmyHPrzg8kd_E  (fixture QA cmons9hbh...)
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

interface ParagraphRange {
  startIndex: number;
  endIndex: number;
  text: string;
  hasLargeFont: boolean;
  isCentered: boolean;
}

function collectParagraphs(doc: docs_v1.Schema$Document): ParagraphRange[] {
  const out: ParagraphRange[] = [];
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    let text = "";
    let hasLargeFont = false;
    for (const el of para.elements || []) {
      const tr = el.textRun;
      if (!tr) continue;
      text += tr.content || "";
      const sz = tr.textStyle?.fontSize?.magnitude ?? 0;
      if (sz >= 48) hasLargeFont = true;
    }
    if (block.startIndex === undefined || block.endIndex === undefined) continue;
    out.push({
      startIndex: block.startIndex!,
      endIndex: block.endIndex!,
      text,
      hasLargeFont,
      isCentered: para.paragraphStyle?.alignment === "CENTER",
    });
  }
  return out;
}

async function main() {
  const docId = arg("docId");
  if (!docId) {
    console.error("Uso: --docId=<doc-id>");
    process.exit(1);
  }

  const doc = await getDocStructure(docId);
  const paras = collectParagraphs(doc);

  // Caso 1 — token literal ainda no doc
  const tokenPara = paras.find((p) => p.text.includes("[[WATERMARK_MINUTA]]"));
  if (tokenPara) {
    console.log(
      `Achado parágrafo com [[WATERMARK_MINUTA]] em [${tokenPara.startIndex}, ${tokenPara.endIndex}). Deletando…`
    );
    await batchUpdateDoc(docId, [
      {
        deleteContentRange: {
          range: { startIndex: tokenPara.startIndex, endIndex: tokenPara.endIndex },
        },
      },
    ]);
    console.log("✓ Watermark token + parágrafo deletados.");
    return;
  }

  // Caso 2 — token já foi removido pelo approve mas o parágrafo gigante vazio
  // sobrou no topo do doc (≥48pt + center + texto só whitespace)
  // Considera apenas os 3 primeiros parágrafos (topo do doc).
  const topParas = paras.slice(0, 3);
  const ghost = topParas.find(
    (p) =>
      p.hasLargeFont &&
      p.isCentered &&
      p.text.trim().length === 0 &&
      p.endIndex - p.startIndex > 1
  );
  if (ghost) {
    console.log(
      `Achado parágrafo fantasma no topo (vazio, fontSize≥48, center) em [${ghost.startIndex}, ${ghost.endIndex}). Deletando…`
    );
    await batchUpdateDoc(docId, [
      {
        deleteContentRange: {
          range: { startIndex: ghost.startIndex, endIndex: ghost.endIndex },
        },
      },
    ]);
    console.log("✓ Parágrafo fantasma deletado.");
    return;
  }

  console.log(
    "• Nenhum watermark encontrado (nem token literal, nem parágrafo fantasma). Nada a fazer."
  );
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
