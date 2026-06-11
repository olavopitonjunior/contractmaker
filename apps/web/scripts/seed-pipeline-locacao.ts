// scripts/seed-pipeline-locacao.ts
// Cria 1 Pipeline kind="locacao" por org com os 6 stages do Pipeline de Locação
// (esteira COMERCIAL, sob /pipeline/locacao):
// Em Aprovação → Formulário → Em contrato → Assinado → Cobrança Gerada → ADM.
// "ADM" é o stage terminal: o negócio graduou do comercial para a administração.
// Idempotente: detecta pipeline kind="locacao" já existente por org.
//
// Uso:
//   pnpm tsx apps/web/scripts/seed-pipeline-locacao.ts          # dry-run
//   pnpm tsx apps/web/scripts/seed-pipeline-locacao.ts --apply  # aplica

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId="));
const TARGET_ORG = ORG_ARG ? ORG_ARG.split("=")[1] : null;

interface StageSeed {
  name: string;
  position: number;
  color: string;
}

const STAGES: StageSeed[] = [
  { name: "Em Aprovação", position: 0, color: "indigo" },
  { name: "Formulário", position: 1, color: "amber" },
  { name: "Em contrato", position: 2, color: "yellow" },
  { name: "Assinado", position: 3, color: "blue" },
  { name: "Cobrança Gerada", position: 4, color: "purple" },
  { name: "ADM", position: 5, color: "green" },
  { name: "Negócio perdido", position: 6, color: "red" },
];

async function main() {
  console.log(APPLY ? "[seed-pipeline-locacao] APPLY mode" : "[seed-pipeline-locacao] DRY-RUN");

  const orgs = await prisma.organization.findMany({
    where: TARGET_ORG ? { id: TARGET_ORG } : {},
    select: { id: true, name: true },
  });
  console.log(`Encontradas ${orgs.length} org(s).`);

  let created = 0;
  let skipped = 0;
  for (const org of orgs) {
    const existing = await prisma.pipeline.findFirst({
      where: { orgId: org.id, kind: "locacao" },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      console.log(`  [${org.name ?? org.id}] já tem pipeline locação (${existing.id})`);
      continue;
    }

    if (APPLY) {
      const pipeline = await prisma.pipeline.create({
        data: {
          orgId: org.id,
          name: "Pipeline de Locação",
          kind: "locacao",
          stages: {
            create: STAGES.map((s) => ({
              name: s.name,
              position: s.position,
              color: s.color,
            })),
          },
        },
      });
      console.log(`  [${org.name ?? org.id}] + Pipeline locação ${pipeline.id} com ${STAGES.length} stages`);
    } else {
      console.log(`  [${org.name ?? org.id}] criaria pipeline com ${STAGES.length} stages`);
    }
    created++;
  }

  console.log(`Created: ${created} · Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
