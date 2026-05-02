/**
 * Materializa um ContractTemplate (.hbs) como um Google Doc nativo no Drive
 * da service account, e registra o `googleTemplateDocId` na linha. Roda a
 * migração descrita em `lib/google/template-migration.ts`.
 *
 * Uso:
 *   npx ts-node scripts/migrate-template-to-gdocs.ts \
 *     --templateId=<id-do-ContractTemplate>
 *
 *   ou (para localizar por modalidade):
 *   npx ts-node scripts/migrate-template-to-gdocs.ts \
 *     --modalidade=a_vista
 *     --orgId=<orgId>
 *
 *   Flags opcionais:
 *     --folderId=<id-da-pasta-Drive>   Override de GOOGLE_DRIVE_FOLDER_ID
 *     --dryRun                          Gera HTML local; não cria Google Doc
 *
 * Pré-requisitos no env (.env):
 *   GOOGLE_SERVICE_ACCOUNT_JSON   credencial da service account (JSON inline)
 *   GOOGLE_DRIVE_FOLDER_ID        id da pasta destino (opcional se --folderId)
 *
 * Após rodar:
 *   - O ContractTemplate é atualizado com `googleTemplateDocId` e `engine="google_docs"`.
 *   - Próximos contratos gerados a partir desse template usam o Google Doc.
 *   - Você deve abrir o doc gerado e revisar manualmente:
 *       a) blocos {{#each}} foram renderizados como 1 instância — duplicar se
 *          o contrato real costuma ter mais (vendedores/compradores múltiplos)
 *       b) ajustar tipografia (fonte, drop cap, ornamentos) usando recursos
 *          nativos do Google Docs
 *       c) validar todos os placeholders {{path}} existem em `placeholders.ts`
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  buildPlaceholderHtml,
  migrateTemplateToGoogleDoc,
} from "../src/lib/google/template-migration";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const templateId = arg("templateId");
  const modalidade = arg("modalidade");
  const orgId = arg("orgId");
  const folderId = arg("folderId");
  const sourcePath = arg("sourcePath");
  const dryRun = flag("dryRun");

  // Modo dry-run + sourcePath: testa a conversão sem precisar de DB.
  if (dryRun && sourcePath) {
    const source = fs.readFileSync(path.resolve(sourcePath), "utf-8");
    const html = buildPlaceholderHtml(source);
    const outPath = path.resolve(
      process.cwd(),
      path.basename(sourcePath, path.extname(sourcePath)) + ".converted.html"
    );
    fs.writeFileSync(outPath, html, "utf-8");
    console.log(`Dry run (source-only): HTML escrito em ${outPath}`);
    console.log(`  source: ${source.length} chars`);
    console.log(`  output: ${html.length} chars`);
    return;
  }

  let template;
  if (templateId) {
    template = await prisma.contractTemplate.findUnique({ where: { id: templateId } });
  } else if (modalidade && orgId) {
    template = await prisma.contractTemplate.findFirst({
      where: { orgId, modalidade, isDefault: true, status: "active" },
    });
  } else {
    console.error("Uso: --templateId=<id> OU (--modalidade=<x> --orgId=<y>) OU (--sourcePath=<file> --dryRun)");
    process.exit(1);
  }

  if (!template) {
    console.error("Template não encontrado.");
    process.exit(1);
  }

  console.log(`Migrando template: ${template.name} (modalidade=${template.modalidade})`);
  console.log(`Source length: ${template.handlebarsSource.length} chars`);

  if (dryRun) {
    const html = buildPlaceholderHtml(template.handlebarsSource);
    const outPath = path.resolve(process.cwd(), `template-${template.id}.html`);
    fs.writeFileSync(outPath, html, "utf-8");
    console.log(`Dry run: HTML escrito em ${outPath}`);
    console.log("Inspecione antes de rodar sem --dryRun.");
    return;
  }

  console.log("Criando Google Doc no Drive…");
  const result = await migrateTemplateToGoogleDoc({
    templateSource: template.handlebarsSource,
    templateName: `Modelo Contractmaker — ${template.name}`,
    parentFolderId: folderId,
  });

  console.log(`✓ Google Doc criado: ${result.webViewLink}`);
  console.log(`  id: ${result.googleDocId}`);

  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: {
      googleTemplateDocId: result.googleDocId,
      engine: "google_docs",
    },
  });

  console.log("✓ ContractTemplate atualizado: engine=google_docs");
  console.log("");
  console.log("Próximos passos manuais:");
  console.log("  1. Abrir o doc e revisar blocos {{#each}} (atualmente 1 instância)");
  console.log("  2. Aplicar tipografia Zimmermann (drop cap, ornamentos)");
  console.log("  3. Adicionar header/footer + watermark MINUTA via Inserir → Cabeçalho");
  console.log(`  4. Testar: gerar um contrato e validar a substituição de placeholders`);
}

main()
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
