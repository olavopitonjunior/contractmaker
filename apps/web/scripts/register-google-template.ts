/**
 * Liga um ContractTemplate ao seu doc-modelo nativo no Google Docs.
 *
 * Uso:
 *   npx ts-node scripts/register-google-template.ts \
 *     --templateId=<id-do-ContractTemplate> \
 *     --googleDocId=<id-do-Google-Doc>
 *
 * Antes de rodar:
 *   1. No Drive da service account (ou em uma pasta compartilhada com ela
 *      como "editor"), crie ou faça upload do template `.docx` do Zimmermann
 *      e abra como Google Doc.
 *   2. Substitua os tokens Handlebars (`{{moeda x}}`, `{{cpf x}}`...) por
 *      placeholders simples no formato `{{flat.key}}` — a função
 *      `flattenForGoogleDoc` produz a chave automaticamente. Ex:
 *        - Em vez de `{{moeda pagamento.valor_total}}` → `{{pagamento.valor_total_moeda}}`
 *        - Em vez de `{{cpf vendedor.cpf}}`           → `{{vendedor1.cpf_fmt}}`
 *        - Em vez de `{{dataExtenso contrato.data}}`  → `{{contrato.data_extenso}}`
 *   3. Pegue o id do doc na URL: `docs.google.com/document/d/<DOC_ID>/edit`
 *   4. Rode este script.
 *
 * O comando não muta o `.hbs` source — apenas anota o `googleTemplateDocId`
 * e troca `engine` para `google_docs`. Se você reverter, é só limpar o campo.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main() {
  const templateId = arg("templateId");
  const googleDocId = arg("googleDocId");

  if (!templateId || !googleDocId) {
    console.error("Uso: --templateId=<id> --googleDocId=<id>");
    process.exit(1);
  }

  const template = await prisma.contractTemplate.findUnique({
    where: { id: templateId },
  });
  if (!template) {
    console.error(`Template ${templateId} não encontrado.`);
    process.exit(1);
  }

  const updated = await prisma.contractTemplate.update({
    where: { id: templateId },
    data: {
      googleTemplateDocId: googleDocId,
      engine: "google_docs",
    },
  });

  console.log("Template registrado com sucesso:");
  console.log(`  id:                  ${updated.id}`);
  console.log(`  name:                ${updated.name}`);
  console.log(`  modalidade:          ${updated.modalidade}`);
  console.log(`  engine:              ${updated.engine}`);
  console.log(`  googleTemplateDocId: ${updated.googleTemplateDocId}`);
  console.log("");
  console.log(
    "Próximos contratos gerados com este template usarão o Google Doc nativo " +
      "(desde que USE_GOOGLE_DOCS_EDITOR=true no env)."
  );
}

main()
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
