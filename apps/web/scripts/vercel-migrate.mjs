// Aplica `prisma migrate deploy` APENAS em deploy de produção do Vercel.
//
// Motivo: no Vercel, o projeto `web` builda tanto produção (master) quanto os
// PREVIEWS de PR. Até 2026-07-14 o escopo Preview injetava o DATABASE_URL de
// PRODUÇÃO, então todo preview de PR rodava `migrate deploy` contra o banco de
// prod — e uma migration quebrada num PR travava os deploys de produção ANTES
// do merge (incidente 2026-07-14; ver memória project_clicksign_multitenant).
//
// Isso FOI CORRIGIDO: hoje o escopo Preview tem DATABASE_URL/DIRECT_URL
// próprios, apontando pro branch Neon de staging (conferido em 2026-08-25
// comparando os hosts: Preview `ep-morning-leaf-…`, Production
// `ep-bitter-wildflower-…`). O guard fica assim mesmo — defesa em profundidade:
// ele não depende de a env estar configurada certo, e é a env que já errou uma
// vez. Ver docs/staging-workflow.md.
//
// Regra: roda a migration quando VERCEL_ENV=production, OU quando
// FORCE_MIGRATE=1 (escape hatch explícito). Em qualquer outro caso — preview,
// development, ou a máquina de alguém, onde VERCEL_ENV nem existe — PULA.
//
// A ausência de VERCEL_ENV já significou "migra" aqui, e era metade do defeito
// da issue #375: `npm run build` na máquina de alguém aplicava migration
// contra o banco que o `.env` daquela pasta apontasse, sem perguntar. A outra
// metade foi tirar este script do `build` e movê-lo para `build:deploy`. As
// duas juntas fazem o conserto valer por construção e não por roteamento: nem
// um `build:deploy` local, nem um `vercel build` na máquina, nem um override
// de buildCommand que apareça amanhã voltam a migrar sem alguém pedir.
//
// Quem quer migrar à mão tem `prisma migrate dev` (ou `FORCE_MIGRATE=1`).
import { execSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV; // production | preview | development | undefined(local)
const force = process.env.FORCE_MIGRATE === "1";

const shouldMigrate = force || vercelEnv === "production";

if (!shouldMigrate) {
  console.log(
    `[migrate] VERCEL_ENV=${vercelEnv ?? "(local)"} → pulando \`prisma migrate deploy\`. ` +
      `Só o deploy de produção do Vercel migra; para forçar, FORCE_MIGRATE=1.`
  );
  process.exit(0);
}

console.log(
  `[migrate] VERCEL_ENV=${vercelEnv ?? "(local)"}${force ? " (FORCE_MIGRATE=1)" : ""} → rodando \`prisma migrate deploy\`.`
);
execSync("prisma migrate deploy", { stdio: "inherit" });
