// Dry-run do fix contra o dataJson real da Aidê. Não muta nada:
// puxa o form da Aidê do DB de prod, roda enrichContractData + renderContratoHTML
// contra os templates v2 atualizados, e imprime trechos relevantes pra
// confirmar que a cláusula 2.1.4 (saldo devedor) e demais agora renderizam.

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { enrichContractData } from "../src/lib/services/contract-generation";
import { renderContratoHTML } from "../src/lib/render/handlebars";

const prisma = new PrismaClient();
const AIDE_DEAL_ID = "cmp66g8af00053jyjr5oi4p3s";

async function main() {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT d."dataJson" as deal_data, f."dataJson" as form_data
     FROM "Deal" d LEFT JOIN "SalesForm" f ON f."id" = d."formId"
     WHERE d."id" = $1`,
    AIDE_DEAL_ID
  )) as Array<{ deal_data: any; form_data: any }>;
  if (rows.length === 0) {
    console.error("Deal Aidê não encontrado");
    process.exit(1);
  }
  const dataJson = (rows[0].form_data ?? rows[0].deal_data) as Record<string, unknown>;
  console.log("dataJson keys:", Object.keys(dataJson).sort().join(", "));
  console.log(`saldo_devedor (top-level): ${JSON.stringify(dataJson.saldo_devedor)}`);
  console.log(`status_propriedade: ${JSON.stringify(dataJson.status_propriedade)}`);
  console.log(`incluso_no_preco: ${JSON.stringify(dataJson.incluso_no_preco)}`);

  const enriched = enrichContractData(JSON.parse(JSON.stringify(dataJson)));
  const config = (enriched as any).config as Record<string, unknown>;
  console.log("\nApós enrichContractData:");
  console.log(`  config.saldo_devedor_vendedor: ${JSON.stringify(config.saldo_devedor_vendedor)}`);
  console.log(`  config.tem_debitos: ${JSON.stringify(config.tem_debitos)}`);
  console.log(`  config.vicios_opcao: ${JSON.stringify(config.vicios_opcao)}`);
  console.log(`  config.itens_entrega: ${JSON.stringify(config.itens_entrega)}`);
  console.log(`  config.permuta_descricao: ${JSON.stringify(config.permuta_descricao)}`);

  const templatePath = path.resolve(__dirname, "../../../templates/ccv_financiamento_v2.hbs");
  const template = fs.readFileSync(templatePath, "utf-8");
  const html = renderContratoHTML(template, enriched as Record<string, unknown>);

  // Procurar a cláusula 2.1.4
  const idx214 = html.indexOf("2.1.4.");
  console.log(`\nHTML renderizado: ${html.length} chars`);
  console.log(`Cláusula 2.1.4 presente: ${idx214 >= 0 ? "SIM" : "NÃO"}`);
  if (idx214 >= 0) {
    console.log("Trecho:");
    console.log(html.slice(idx214, idx214 + 600).replace(/<[^>]+>/g, ""));
  } else {
    // Pode estar como "2.1.5." se 2.1.4 já era usado por outra coisa
    const m = html.match(/<p><strong>2\.1\.\d+\.<\/strong>[^<]*saldo devedor[^<]*<\/p>/i);
    if (m) {
      console.log("Encontrado (numeração alternativa):");
      console.log(m[0].replace(/<[^>]+>/g, ""));
    }
  }

  // Saldo absoluto no HTML
  const hasSaldoValue = html.includes("87.832");
  console.log(`Valor "87.832" presente no HTML: ${hasSaldoValue ? "SIM" : "NÃO"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
