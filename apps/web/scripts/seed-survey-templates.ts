// scripts/seed-survey-templates.ts
// Cria o template padrão de pesquisa de satisfação nas orgs que não têm NENHUM
// template ativo (isLatest=true, status="active") e têm alguma feature de
// pesquisas habilitada. Idempotente por (orgId, name) — não recria se a org já
// teve um template com esse nome, mesmo arquivado.
//
// Uso:
//   pnpm tsx apps/web/scripts/seed-survey-templates.ts                  # dry-run
//   pnpm tsx apps/web/scripts/seed-survey-templates.ts --apply          # aplica em todas
//   pnpm tsx apps/web/scripts/seed-survey-templates.ts --apply --orgId=cm...   # uma org

import { prisma } from "@/lib/db/prisma";
import { isAnySurveyFeatureEnabled } from "@/lib/surveys/guard";
import {
  DEFAULT_SURVEY_TEMPLATE,
  seedDefaultSurveyTemplateForOrg,
} from "@/lib/surveys/seed";

const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId"));
const TARGET_ORG = ORG_ARG?.startsWith("--orgId=") ? ORG_ARG.split("=")[1] : null;
// `--orgId` sem `=valor` (ou forma com espaço) viraria filtro nulo e o --apply
// rodaria em TODAS as orgs — o oposto da intenção. Falha cedo.
if (ORG_ARG && !TARGET_ORG) {
  console.error("Uso: --orgId=<id> (com '='). Abortando pra não aplicar em todas as orgs.");
  process.exit(1);
}

async function main() {
  console.log(
    APPLY ? "[seed-survey-templates] APPLY mode" : "[seed-survey-templates] DRY-RUN"
  );

  const orgs = await prisma.organization.findMany({
    where: {
      ...(TARGET_ORG ? { id: TARGET_ORG } : {}),
      surveyTemplates: { none: { isLatest: true, status: "active" } },
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Org(s) sem template ativo: ${orgs.length}`);
  if (TARGET_ORG && orgs.length === 0) {
    console.log(
      "Nada a fazer: org não encontrada OU já tem template ativo (confira o id)."
    );
  }

  let created = 0;
  let skippedFeature = 0;
  let skippedName = 0;
  let skippedNoOwner = 0;
  let skippedActive = 0;
  for (const org of orgs) {
    if (!(await isAnySurveyFeatureEnabled(org.id))) {
      skippedFeature++;
      console.log(`  [${org.name ?? org.id}] pesquisas desabilitadas — pulando`);
      continue;
    }
    const result = await seedDefaultSurveyTemplateForOrg(org.id, { apply: APPLY });
    if (result === "has_active") {
      // Template criado entre o findMany e este ponto (ex.: admin/orgs semeando
      // uma org nova no meio do run).
      skippedActive++;
      console.log(`  [${org.name ?? org.id}] ganhou template ativo durante o run — pulando`);
      continue;
    }
    if (result === "no_owner") {
      skippedNoOwner++;
      console.log(`  [${org.name ?? org.id}] sem membership owner — pulando`);
      continue;
    }
    if (result === "name_exists") {
      skippedName++;
      console.log(
        `  [${org.name ?? org.id}] já tem "${DEFAULT_SURVEY_TEMPLATE.name}" (inativo) — pulando`
      );
      continue;
    }
    if (result === "created" || result === "would_create") {
      created++;
      console.log(
        `  [${org.name ?? org.id}] ${result === "created" ? "+" : "(dry-run) criaria"} "${DEFAULT_SURVEY_TEMPLATE.name}"`
      );
    }
  }
  console.log(
    `${APPLY ? "Created" : "Would create"}: ${created} · Skipped (feature off): ${skippedFeature} · Skipped (nome já existe): ${skippedName} · Skipped (sem owner): ${skippedNoOwner} · Skipped (ativo durante o run): ${skippedActive}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
