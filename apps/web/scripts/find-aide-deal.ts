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
    console.log("Nenhum deal encontrado com 'aide'. Tentando busca mais ampla por 'aíde'/'Aide'...");
    const broad = (await prisma.$queryRawUnsafe(
      `SELECT "Deal"."id", "Deal"."title"
       FROM "Deal"
       WHERE "Deal"."title" ILIKE '%aíde%'
          OR "Deal"."dataJson"::text ILIKE '%aíde%'
       LIMIT 10`
    )) as Array<{ id: string; title: string }>;
    console.log(`Busca ampla matches: ${broad.length}`);
    for (const d of broad) candidates.push(d.id);
  }

  for (const id of candidates) {
    const deal = titleMatches.find((d) => d.id === id) ?? (await prisma.deal.findUnique({
      where: { id },
      include: {
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
    }));
    if (!deal) continue;

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
