// Diagnostic script — encontra o(s) deal(s) da Aide e mostra o estado
// do saldo devedor no form vs no template renderizado, validando o bug
// que motivou a correção dos bridges form→template.
//
// Uso (com DATABASE_URL de prod no env):
//   cd apps/web && pnpm tsx scripts/find-aide-deal.ts
//
// Read-only — não muta nada.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Buscando deals com 'aide' no título ou dataJson...\n");

  const titleMatches = await prisma.deal.findMany({
    where: { title: { contains: "aide", mode: "insensitive" } },
    select: {
      id: true,
      title: true,
      createdAt: true,
      formId: true,
      dataJson: true,
      form: { select: { dataJson: true, completedAt: true } },
      contracts: {
        where: { isLatest: true },
        select: {
          id: true,
          version: true,
          status: true,
          googleDocId: true,
          googleDocUrl: true,
          dataJson: true,
        },
      },
    },
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  const dataJsonMatches = (await prisma.$queryRawUnsafe(
    `SELECT "Deal"."id", "Deal"."title", "Deal"."createdAt"
     FROM "Deal"
     WHERE "Deal"."dataJson"::text ILIKE '%aide%'
        OR "Deal"."dataJson"::text ILIKE '%AIDE%'
     LIMIT 10`
  )) as Array<{ id: string; title: string; createdAt: Date }>;

  console.log(`Title matches: ${titleMatches.length}`);
  console.log(`dataJson matches: ${dataJsonMatches.length}\n`);

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const d of titleMatches) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      candidates.push(d.id);
    }
  }
  for (const d of dataJsonMatches) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      candidates.push(d.id);
    }
  }

  if (candidates.length === 0) {
    console.log("Nenhum deal encontrado com 'aide'. Tentando 'aída', 'aíd', 'ayde'...");
    const patterns = ["%aída%", "%aíd%", "%ayde%", "%aida%", "%ai%d%"];
    for (const pat of patterns) {
      const broad = (await prisma.$queryRawUnsafe(
        `SELECT "Deal"."id", "Deal"."title"
         FROM "Deal"
         WHERE "Deal"."title" ILIKE $1
            OR "Deal"."dataJson"::text ILIKE $1
         LIMIT 10`,
        pat
      )) as Array<{ id: string; title: string }>;
      if (broad.length > 0) {
        console.log(`Pattern '${pat}': ${broad.length} matches`);
        for (const d of broad) {
          console.log(`  ${d.id} — ${d.title}`);
          if (!seen.has(d.id)) {
            seen.add(d.id);
            candidates.push(d.id);
          }
        }
      }
    }
    // Sondagem geral: deals recentes c/ financiamento + saldo > 0
    if (candidates.length === 0) {
      console.log("\nFallback: deals recentes com saldo_devedor > 0 (qualquer nome):");
      const withSaldo = (await prisma.$queryRawUnsafe(
        `SELECT d."id", d."title", d."createdAt",
                COALESCE(f."dataJson"->>'saldo_devedor', d."dataJson"->>'saldo_devedor') as saldo
         FROM "Deal" d
         LEFT JOIN "SalesForm" f ON f."id" = d."formId"
         WHERE COALESCE(f."dataJson"->>'saldo_devedor', d."dataJson"->>'saldo_devedor') IS NOT NULL
           AND COALESCE(f."dataJson"->>'saldo_devedor', d."dataJson"->>'saldo_devedor') <> '0'
         ORDER BY d."createdAt" DESC
         LIMIT 20`
      )) as Array<{ id: string; title: string; createdAt: Date; saldo: string }>;
      for (const d of withSaldo) {
        console.log(`  ${d.id} | ${d.createdAt.toISOString()} | saldo=R$ ${d.saldo} | ${d.title}`);
        if (!seen.has(d.id)) {
          seen.add(d.id);
          candidates.push(d.id);
        }
      }
    }
  }

  for (const id of candidates) {
    // Usa raw SQL pra evitar drift de schema (ex.: Deal.complianceJson
    // existe local mas não em prod). select explícito só dos campos que precisamos.
    const dealRows = (await prisma.$queryRawUnsafe(
      `SELECT d."id", d."title", d."createdAt", d."formId", d."dataJson",
              f."dataJson" as "form_dataJson", f."completedAt" as "form_completedAt"
       FROM "Deal" d
       LEFT JOIN "SalesForm" f ON f."id" = d."formId"
       WHERE d."id" = $1`,
      id
    )) as Array<{
      id: string;
      title: string;
      createdAt: Date;
      formId: string | null;
      dataJson: Record<string, unknown> | null;
      form_dataJson: Record<string, unknown> | null;
      form_completedAt: Date | null;
    }>;
    if (dealRows.length === 0) continue;
    const row = dealRows[0];
    const contractRows = (await prisma.$queryRawUnsafe(
      `SELECT "id", "version", "status", "googleDocId", "googleDocUrl", "dataJson"
       FROM "Contract"
       WHERE "dealId" = $1 AND "isLatest" = true
       LIMIT 1`,
      id
    )) as Array<{
      id: string;
      version: number;
      status: string;
      googleDocId: string | null;
      googleDocUrl: string | null;
      dataJson: Record<string, unknown> | null;
    }>;
    const deal = {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      formId: row.formId,
      dataJson: row.dataJson,
      form: row.formId
        ? { dataJson: row.form_dataJson, completedAt: row.form_completedAt }
        : null,
      contracts: contractRows,
    };

    const formData = (deal.form?.dataJson ?? deal.dataJson) as Record<string, unknown>;
    const saldoForm = formData?.saldo_devedor ?? null;
    const statusProp = formData?.status_propriedade ?? null;
    const debitos = formData?.debitos ?? null;
    const vicios = formData?.vicios ?? null;
    const incluso = formData?.incluso_no_preco ?? null;

    const contract = deal.contracts[0];
    const contractConfig = (contract?.dataJson as { config?: Record<string, unknown> })?.config;
    const saldoContrato = contractConfig?.saldo_devedor_vendedor ?? null;
    const itensContrato = contractConfig?.itens_entrega ?? null;

    console.log("====================================================");
    console.log(`Deal: ${deal.id}`);
    console.log(`  Title: ${deal.title}`);
    console.log(`  Created: ${deal.createdAt}`);
    console.log(`  Form completedAt: ${deal.form?.completedAt ?? "—"}`);
    console.log("");
    console.log("  Form data (relevante):");
    console.log(`    saldo_devedor (top-level): ${JSON.stringify(saldoForm)}`);
    console.log(`    status_propriedade: ${JSON.stringify(statusProp)}`);
    console.log(`    debitos: ${JSON.stringify(debitos)}`);
    console.log(`    vicios: ${JSON.stringify(vicios)}`);
    console.log(`    incluso_no_preco: ${JSON.stringify(incluso)}`);
    console.log("");
    if (contract) {
      console.log(`  Contract v${contract.version} (${contract.id}):`);
      console.log(`    status: ${contract.status}`);
      console.log(`    googleDocUrl: ${contract.googleDocUrl ?? "—"}`);
      console.log(`    config.saldo_devedor_vendedor: ${JSON.stringify(saldoContrato)}`);
      console.log(`    config.itens_entrega: ${JSON.stringify(itensContrato)}`);
      console.log("");

      // Diagnóstico
      const bug = Number(saldoForm) > 0 && (saldoContrato == null || saldoContrato === 0);
      console.log(`  >>> BUG DETECTADO: ${bug ? "SIM" : "não"} <<<`);
      if (bug) {
        console.log(
          `      Form tem saldo R$ ${saldoForm}, mas contrato gerado tem config.saldo_devedor_vendedor=${JSON.stringify(saldoContrato)}.`
        );
        console.log(
          `      Após aplicar o fix, regenerar o contrato (nova versão) trará a cláusula 2.1.4 com o saldo.`
        );
      }
    } else {
      console.log("  Nenhum Contract gerado (deal ainda em form?).");
    }
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
