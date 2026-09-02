/**
 * QA E2E da ingestão "modelo da imobiliária → template" (engine google_docs)
 * SEM passar pelo browser: roda o mesmo pipeline da rota /api/templates/from-docx
 * contra o ambiente apontado pelos envs (staging).
 *
 * Uso:
 *   DATABASE_URL=... GOOGLE_*=... ANTHROPIC_API_KEY=... \
 *   npx tsx scripts/qa-modelo-imobiliaria.ts --file "C:\caminho\modelo.docx" \
 *     --org <orgId> --modalidade locacao [--activate]
 */
import fs from "fs";
import { prisma } from "../src/lib/db/prisma";
import { uploadFileAsGoogleDoc } from "../src/lib/google/upload-file-as-gdoc";
import { insertPlaceholdersWithAI } from "../src/lib/templates/ai-placeholder-insertion";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const SCHEMA_TYPE: Record<string, string> = {
  locacao: "locacao_residencial_v1",
  locacao_comercial: "locacao_comercial_v1",
  a_vista: "compra_venda_v2",
  financiamento: "compra_venda_v2",
};

async function main() {
  const file = arg("file");
  const orgId = arg("org");
  const modalidade = arg("modalidade") ?? "locacao";
  const activate = process.argv.includes("--activate");
  if (!file || !orgId) {
    console.error("--file e --org são obrigatórios");
    process.exit(1);
  }

  const buffer = fs.readFileSync(file);
  console.log(`[qa] DOCX ${file} (${buffer.length} bytes) → Drive…`);

  const uploaded = await uploadFileAsGoogleDoc({
    buffer,
    sourceMime:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    name: `[MODELO] QA identidade visual — ${modalidade}`,
    orgId,
  });
  console.log(`[qa] Doc criado: ${uploaded.docId}`);
  console.log(`[qa] ${uploaded.webViewLink}`);

  const template = await prisma.contractTemplate.create({
    data: {
      orgId,
      name: `Locação — modelo da imobiliária (QA E2E)`,
      description: "Template criado pelo QA E2E da identidade visual.",
      engine: "google_docs",
      status: "draft",
      isDefault: false,
      googleTemplateDocId: uploaded.docId,
      modalidade,
      schemaType: SCHEMA_TYPE[modalidade],
      handlebarsSource: "<!-- engine=google_docs: a fonte é o Google Doc -->",
      version: "1.0.0",
    },
  });
  console.log(`[qa] Template draft: ${template.id}`);

  console.log(`[qa] Pass de IA (Sonnet) inserindo placeholders…`);
  const report = await insertPlaceholdersWithAI({
    docId: uploaded.docId,
    modalidade,
    orgId,
  });
  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: { draftReport: report as object },
  });

  console.log(`[qa] inseridos (${report.inserted.length}):`);
  for (const i of report.inserted) console.log(`   ✓ {{${i.token}}} ← "${i.trecho.slice(0, 70)}..."`);
  console.log(`[qa] pulados (${report.skippedAmbiguous.length}):`);
  for (const s of report.skippedAmbiguous)
    console.log(`   ↷ ${s.token} (${s.reason}) "${s.trecho.slice(0, 60)}"`);
  console.log(
  `[qa] não mapeados: ${
    report.notMapped.map((n) => `${n.token} (${n.reason})`).join(", ") || "(nenhum)"
  }`
);
  console.log(`[qa] obrigatórios ausentes: ${report.missingRequired.join(", ") || "(nenhum)"}`);

  if (activate) {
    await prisma.contractTemplate.updateMany({
      where: { orgId, modalidade, isDefault: true },
      data: { isDefault: false },
    });
    await prisma.contractTemplate.update({
      where: { id: template.id },
      data: { status: "active", isDefault: true },
    });
    console.log(`[qa] Template ATIVADO como padrão de ${modalidade}.`);
  } else {
    console.log(`[qa] Draft mantido — revisar em /templates/${template.id}/review`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[qa] ERRO:", err);
  process.exit(1);
});
