/**
 * Diagnóstico: por que POST /api/deals/:dealId/certidoes está retornando
 * PrismaClientKnownRequestError pra um deal específico.
 *
 * Carrega DATABASE_URL de apps/web/.env.vercel-prod.clean (já tratado o `\n`),
 * roda planCertidoesForDeal, e tenta executar o transaction de criação dos
 * CertidaoJob num savepoint que é sempre revertido — assim a falha real do
 * Postgres é capturada e impressa sem alterar prod.
 *
 * Uso:
 *   pnpm tsx apps/web/scripts/diag-certidoes-deal.ts <dealId>
 */

import fs from "fs";
import path from "path";

const ENV_FILES = [".env.vercel-prod.clean", ".env.vercel-prod", ".env"];
for (const name of ENV_FILES) {
  const p = path.resolve(__dirname, "..", name);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(.*))$/);
      if (m && !process.env[m[1]]) {
        let v = (m[2] ?? m[3] ?? m[4] ?? "").trim();
        v = v.replace(/\\n/g, "");
        process.env[m[1]] = v;
      }
    });
  break;
}

import { PrismaClient, Prisma } from "@prisma/client";
import { planCertidoesForDeal } from "../src/lib/certidoes/planner";
import { endpointInfo } from "../src/lib/certidoes/endpoints";
import { sanitizePayload } from "../src/lib/certidoes/infosimples";

const dealId = process.argv[2];
if (!dealId) {
  console.error("Uso: pnpm tsx diag-certidoes-deal.ts <dealId>");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log(`\n=== Diagnóstico do deal ${dealId} ===\n`);

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { form: { select: { orgId: true, dataJson: true } } },
  });
  if (!deal) {
    console.error("Deal não encontrado.");
    return;
  }
  console.log("Deal:", {
    id: deal.id,
    stageId: deal.stageId,
    formId: deal.formId,
    userId: deal.userId,
    formOrg: deal.form?.orgId,
    formHasData: !!deal.form?.dataJson,
  });

  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ||
    (deal.dataJson as Record<string, unknown> | null);

  const diligenciadosRaw = await prisma.diligentedPerson.findMany({
    where: { dealId },
    orderBy: { createdAt: "asc" },
  });
  console.log("\nDiligenciados:", diligenciadosRaw.length);

  const existingJobs = await prisma.certidaoJob.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  console.log("\nJobs existentes (mais recentes):", existingJobs.length);
  for (const j of existingJobs.slice(0, 10)) {
    console.log(`  - [${j.status}] ${j.endpoint} (${j.targetKind}/${j.targetIndex}) batch=${j.batchId} user=${j.userId} org=${j.orgId} created=${j.createdAt.toISOString()}`);
  }

  // Run planner exatamente como o POST faz
  const diligenciados = diligenciadosRaw.map((d) => ({
    id: d.id,
    tipoPessoa: d.tipoPessoa as "fisica" | "juridica",
    nome: d.nome,
    cpf: d.cpf,
    cnpj: d.cnpj,
    dataNascimento: d.dataNascimento,
    uf: d.uf,
    cidade: d.cidade,
  }));

  const plan = planCertidoesForDeal(
    dealData as any,
    undefined,
    diligenciados,
    { expandAll: false, govBrActive: false }
  );

  console.log(`\nPlanner gerou ${plan.jobs.length} jobs + ${plan.skipped.length} skipped.\n`);
  for (const j of plan.jobs) {
    console.log(`  job: ${j.endpoint} kind=${j.targetKind} idx=${j.targetIndex} cost=${j.costCents}`);
  }
  for (const s of plan.skipped) {
    console.log(`  skipped: ${s.endpoint} kind=${s.targetKind} idx=${s.targetIndex} reason="${s.reason}" missing=${JSON.stringify(s.missingFields ?? s.missingField ?? null)}`);
  }

  // Simula o $transaction num SAVEPOINT que sempre rola back — assim a
  // exception real do Postgres aparece SEM alterar a tabela.
  console.log("\n=== Tentando reproduzir o INSERT (rollback garantido) ===\n");
  const batchId = `diag-${Date.now()}`;
  const userId = deal.userId;

  try {
    await prisma.$transaction(async (tx) => {
      for (const p of plan.jobs) {
        const info = endpointInfo(p.endpoint);
        await tx.certidaoJob.create({
          data: {
            dealId,
            userId,
            batchId,
            endpoint: p.endpoint,
            label: p.label,
            targetKind: p.targetKind,
            targetIndex: p.targetIndex,
            requestPayload: sanitizePayload(p.requestPayload) as object,
            status: info.initialStatus ?? "pending",
            costCents: null,
            portalUrl: info.portalUrl ?? null,
          },
        });
      }
      for (const s of plan.skipped) {
        let portalUrl: string | null = s.externalLink ?? null;
        try {
          portalUrl = endpointInfo(s.endpoint).portalUrl ?? portalUrl;
        } catch {
          /* ignore */
        }
        await tx.certidaoJob.create({
          data: {
            dealId,
            userId,
            batchId,
            endpoint: s.endpoint,
            label: s.label,
            targetKind: s.targetKind,
            targetIndex: s.targetIndex,
            requestPayload: {
              missingField: s.missingField,
              missingFields: s.missingFields,
              ...(s.externalLink ? { externalLink: s.externalLink } : {}),
            } as object,
            status: "skipped",
            errorMessage: s.reason,
            costCents: 0,
            missingFields: s.missingFields?.length
              ? s.missingFields.map((mf) => mf.path)
              : s.missingField
              ? [s.missingField]
              : [],
            portalUrl,
          },
        });
      }
      // ROLLBACK forçado — nunca commita
      throw new Error("__diag_rollback__");
    });
  } catch (err) {
    if (err instanceof Error && err.message === "__diag_rollback__") {
      console.log("✅ Todos os INSERTs passariam — rollback OK. Sem erro Prisma reproduzido.");
    } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.log("❌ Prisma KnownRequestError reproduzido:");
      console.log("   code:    ", err.code);
      console.log("   meta:    ", JSON.stringify(err.meta));
      console.log("   message: ", err.message.split("\n").slice(0, 8).join("\n   "));
    } else if (err instanceof Prisma.PrismaClientValidationError) {
      console.log("❌ Prisma ValidationError reproduzido:");
      console.log(err.message);
    } else {
      console.log("❌ Erro inesperado:");
      console.log(err);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
