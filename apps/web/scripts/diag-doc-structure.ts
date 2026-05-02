/**
 * Inspeciona estrutura de um Google Doc para identificar watermarks ocultos:
 * - documentStyle.background (cor/imagem fundo)
 * - headers / footers (texto fixo no topo/rodapé)
 * - primeiros 5 paragraphs do body com fontSize/alignment/text
 * - inlineObjects (imagens embedded)
 *
 * Uso: npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *        scripts/diag-doc-structure.ts --docId=<id>
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

import { getDocStructure } from "../src/lib/google/docs";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const docId = arg("docId");
  if (!docId) {
    console.error("Uso: --docId=<id>");
    process.exit(1);
  }

  const doc = await getDocStructure(docId);

  console.log("=== documentStyle ===");
  console.log(JSON.stringify(doc.documentStyle, null, 2));

  console.log("\n=== headers ===");
  console.log(JSON.stringify(doc.headers, null, 2));

  console.log("\n=== footers ===");
  console.log(JSON.stringify(doc.footers, null, 2));

  console.log("\n=== inlineObjects (imagens) ===");
  console.log(JSON.stringify(doc.inlineObjects, null, 2));

  console.log("\n=== positionedObjects (floating images/watermarks) ===");
  console.log(JSON.stringify(doc.positionedObjects, null, 2));

  console.log("\n=== primeiros 8 blocks do body ===");
  const blocks = doc.body?.content?.slice(0, 8) || [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b.paragraph) {
      console.log(`[${i}] (não é paragraph) startIndex=${b.startIndex} endIndex=${b.endIndex}`);
      continue;
    }
    const text = (b.paragraph.elements || [])
      .map((el) => el.textRun?.content || (el.inlineObjectElement ? "<INLINE_IMAGE>" : ""))
      .join("");
    const para = b.paragraph;
    const styles = (para.elements || []).map((el) => el.textRun?.textStyle).filter(Boolean);
    console.log(
      `[${i}] startIndex=${b.startIndex} endIndex=${b.endIndex} alignment=${para.paragraphStyle?.alignment} ` +
        `text=${JSON.stringify(text.slice(0, 80))} fontSizes=${styles.map((s) => s?.fontSize?.magnitude).join(",")}`
    );
  }
}

main().catch((e) => {
  console.error("Erro:", e);
  process.exit(1);
});
