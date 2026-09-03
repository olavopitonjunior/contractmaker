/**
 * Imprime os parágrafos de um caso do corpus COM O ÍNDICE que o gabarito usa.
 *
 * O gabarito (`gold/*.json`) aponta onde cada chave deve ficar por índice de
 * parágrafo — depois da padronização o texto não contém mais o valor, então
 * posição é a única forma de afirmar "o CPF do locador virou chave". Anotar à
 * mão exige ver a mesma numeração que o pontuador vê, e é isso que este script
 * imprime: o mesmo `splitDocParagraphs` de todo o resto.
 *
 * Uso:
 *   npx tsx scripts/ai-bench/placeholders/annotate.ts 02-RES-SEM-FIANCA.txt [--max=200]
 */
import fs from "fs";
import path from "path";
import { splitDocParagraphs } from "../../../src/lib/templates/insertion-report";
import { CORPUS_DIR } from "./corpus";

const file = process.argv[2];
if (!file) {
  console.error("uso: annotate.ts <arquivo-do-corpus> [--max=N] [--chars=N]");
  process.exit(1);
}
const max = Number(process.argv.find((a) => a.startsWith("--max="))?.slice(6) ?? 400);
const chars = Number(process.argv.find((a) => a.startsWith("--chars="))?.slice(8) ?? 150);

const text = fs.readFileSync(path.join(CORPUS_DIR, file), "utf8");
const paragraphs = splitDocParagraphs(text);
paragraphs.slice(0, max).forEach((p, i) => {
  console.log(`${String(i).padStart(3, " ")} | ${p.slice(0, chars).replace(/\s+/g, " ")}`);
});
console.log(`\n(${paragraphs.length} parágrafos)`);
