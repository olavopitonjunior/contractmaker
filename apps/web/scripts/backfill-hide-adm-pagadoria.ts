// scripts/backfill-hide-adm-pagadoria.ts
// Decisão 2026-08-20: ADM Locação (`locacao.adm`) e Pagadoria (`vendas.pagadoria`)
// ficam escondidos de TODOS os tenants — os defaults do catálogo viraram false.
// Como override explícito em `OrgModule.featureFlags` vence o default, este
// script REMOVE essas chaves (true OU false) dos flags de todas as orgs: estado
// limpo em que o default do catálogo governa. Religar um tenant depois = gravar
// `true` explícito pelo painel super-admin (/admin/orgs/[orgId]/modules).
//
// Idempotente. Rodar no mesmo dia do deploy do flip (ordem indiferente: sem a
// chave o default antigo vale até o deploy; com a chave o menu fica até o script).
//
// Uso:
//   pnpm tsx apps/web/scripts/backfill-hide-adm-pagadoria.ts               # dry-run
//   pnpm tsx apps/web/scripts/backfill-hide-adm-pagadoria.ts --apply
//   pnpm tsx apps/web/scripts/backfill-hide-adm-pagadoria.ts --apply --orgId=<id>

import { prisma } from "@/lib/db/prisma";

const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId="));
const TARGET_ORG = ORG_ARG ? ORG_ARG.split("=")[1] : null;

const KEYS_BY_MODULE: Record<string, string[]> = {
  locacao: ["locacao.adm"],
  vendas: ["vendas.pagadoria"],
};

async function main() {
  console.log(
    APPLY ? "[backfill-hide-adm-pagadoria] APPLY mode" : "[backfill-hide-adm-pagadoria] DRY-RUN"
  );

  const rows = await prisma.orgModule.findMany({
    where: {
      module: { in: Object.keys(KEYS_BY_MODULE) },
      ...(TARGET_ORG ? { orgId: TARGET_ORG } : {}),
    },
    select: { id: true, orgId: true, module: true, featureFlags: true },
  });

  let changed = 0;
  let untouched = 0;
  for (const row of rows) {
    const flags = row.featureFlags;
    if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
      untouched++;
      continue;
    }
    const keys = KEYS_BY_MODULE[row.module] ?? [];
    const present = keys.filter((k) => k in (flags as Record<string, unknown>));
    if (present.length === 0) {
      untouched++;
      continue;
    }

    const next = { ...(flags as Record<string, unknown>) };
    for (const k of present) delete next[k];

    const detail = present
      .map((k) => `${k}=${JSON.stringify((flags as Record<string, unknown>)[k])}`)
      .join(", ");
    if (APPLY) {
      await prisma.orgModule.update({
        where: { id: row.id },
        data: { featureFlags: next },
      });
      console.log(`[removed] org=${row.orgId} module=${row.module} → ${detail}`);
    } else {
      console.log(`[would remove] org=${row.orgId} module=${row.module} → ${detail}`);
    }
    changed++;
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${changed} row(s) com chave(s) ${
      APPLY ? "removida(s)" : "a remover"
    }, ${untouched} sem override dessas features.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
