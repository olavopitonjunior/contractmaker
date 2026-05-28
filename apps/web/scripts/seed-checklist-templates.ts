// scripts/seed-checklist-templates.ts
// Cria os 3 modelos canônicos de checklist em cada org (Entrada / Renovação / Rescisão).
// Idempotente via @@unique([orgId, nome]).
//
// Uso:
//   pnpm tsx apps/web/scripts/seed-checklist-templates.ts                  # dry-run
//   pnpm tsx apps/web/scripts/seed-checklist-templates.ts --apply          # aplica em todas
//   pnpm tsx apps/web/scripts/seed-checklist-templates.ts --apply --orgId=cm...   # uma org

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId="));
const TARGET_ORG = ORG_ARG ? ORG_ARG.split("=")[1] : null;

interface TemplateSeed {
  nome: string;
  itens: Array<{ titulo: string; obrigatorio: boolean; descricao?: string }>;
}

const TEMPLATES: TemplateSeed[] = [
  {
    nome: "Entrada",
    itens: [
      { titulo: "Documentos do locatário aprovados", obrigatorio: true },
      { titulo: "Análise de crédito aprovada", obrigatorio: true },
      { titulo: "Garantia formalizada", obrigatorio: true },
      { titulo: "Seguro incêndio contratado", obrigatorio: false },
      { titulo: "Vistoria de entrada realizada", obrigatorio: true },
      { titulo: "Laudo de vistoria assinado", obrigatorio: true },
      { titulo: "Chaves entregues", obrigatorio: true },
      { titulo: "Contrato assinado (ClickSign)", obrigatorio: true },
      { titulo: "Registro no condomínio (se aplicável)", obrigatorio: false },
      { titulo: "Cadastro no Asaas concluído", obrigatorio: true },
      { titulo: "Primeira RentCharge materializada", obrigatorio: true },
      { titulo: "Dados bancários do proprietário validados", obrigatorio: true },
      { titulo: "DIMOB configurado no contrato", obrigatorio: false },
      { titulo: "Comunicação inicial ao proprietário", obrigatorio: true },
    ],
  },
  {
    nome: "Renovação",
    itens: [
      { titulo: "Reajuste calculado (IGPM/IPCA)", obrigatorio: true },
      { titulo: "Proprietário consultado sobre renovação", obrigatorio: true },
      { titulo: "Inquilino consultado sobre renovação", obrigatorio: true },
      { titulo: "Aditivo de prorrogação assinado", obrigatorio: true },
      { titulo: "Garantia renovada/revalidada", obrigatorio: true },
      { titulo: "Seguros renovados", obrigatorio: false },
    ],
  },
  {
    nome: "Rescisão",
    itens: [
      { titulo: "Notificação formal recebida", obrigatorio: true },
      { titulo: "Multa rescisória calculada (art. 4 Lei 8.245)", obrigatorio: true },
      { titulo: "Acordo financeiro confirmado", obrigatorio: true },
      { titulo: "Vistoria de saída agendada", obrigatorio: true },
      { titulo: "Vistoria de saída realizada", obrigatorio: true },
      { titulo: "Comparativo entrada↔saída concluído", obrigatorio: true },
      { titulo: "Garantia liberada/devolvida", obrigatorio: true },
      { titulo: "Chaves devolvidas", obrigatorio: true },
      { titulo: "Distrato registrado", obrigatorio: true },
    ],
  },
];

async function main() {
  console.log(APPLY ? "[seed-checklist-templates] APPLY mode" : "[seed-checklist-templates] DRY-RUN");

  const orgs = await prisma.organization.findMany({
    where: TARGET_ORG ? { id: TARGET_ORG } : {},
    select: { id: true, name: true },
  });
  console.log(`Encontradas ${orgs.length} org(s).`);

  let inserted = 0;
  let skipped = 0;
  for (const org of orgs) {
    for (const tpl of TEMPLATES) {
      const existing = await prisma.checklistTemplate.findUnique({
        where: { orgId_nome: { orgId: org.id, nome: tpl.nome } },
      });
      if (existing) {
        skipped++;
        continue;
      }
      if (APPLY) {
        await prisma.checklistTemplate.create({
          data: {
            orgId: org.id,
            nome: tpl.nome,
            itensJson: tpl.itens,
            ativo: true,
          },
        });
      }
      inserted++;
      console.log(`  [${org.name ?? org.id}] + "${tpl.nome}" (${tpl.itens.length} itens)`);
    }
  }
  console.log(`Inserted: ${inserted} · Skipped (existed): ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
