// scripts/backfill-pipelines.ts
// Repara o gap "módulo habilitado mas sem pipeline": para cada OrgModule com
// enabled=true, cria o Pipeline do kind correspondente (venda/locacao) quando
// ainda não existe. Idempotente (seedPipeline no-op quando já há pipeline do
// kind). Só olha rows EXPLÍCITAS enabled=true — não cria pipeline pra orgs
// legadas sem row (fail-open), evitando funis órfãos em massa.
//
// Uso:
//   pnpm tsx apps/web/scripts/backfill-pipelines.ts               # dry-run (todas)
//   pnpm tsx apps/web/scripts/backfill-pipelines.ts --apply       # aplica
//   pnpm tsx apps/web/scripts/backfill-pipelines.ts --apply --orgId=<id>

import { prisma } from "@/lib/db/prisma";
import { seedPipeline, type PipelineKind } from "@/lib/pipelines/seed";

const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId="));
const TARGET_ORG = ORG_ARG ? ORG_ARG.split("=")[1] : null;

function kindForModule(module: string): PipelineKind | null {
  if (module === "locacao") return "locacao";
  if (module === "vendas") return "venda";
  return null;
}

async function main() {
  console.log(APPLY ? "[backfill-pipelines] APPLY mode" : "[backfill-pipelines] DRY-RUN");

  const rows = await prisma.orgModule.findMany({
    where: { enabled: true, ...(TARGET_ORG ? { orgId: TARGET_ORG } : {}) },
    select: { orgId: true, module: true },
  });

  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    const kind = kindForModule(row.module);
    if (!kind) continue;

    const existing = await prisma.pipeline.findFirst({
      where: { orgId: row.orgId, kind },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    if (APPLY) {
      const r = await seedPipeline(row.orgId, kind);
      console.log(`[created] org=${row.orgId} kind=${kind} pipeline=${r.pipelineId}`);
    } else {
      console.log(`[would create] org=${row.orgId} kind=${kind}`);
    }
    created++;
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${created} pipeline(s) ${APPLY ? "criado(s)" : "a criar"}, ${skipped} já presente(s).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
