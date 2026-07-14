// Aplica `prisma migrate deploy` APENAS em deploy de produção.
//
// Motivo: no Vercel, o projeto `web` builda tanto produção (master) quanto os
// PREVIEWS de PR, e o ambiente Preview injeta o DATABASE_URL de PRODUÇÃO. Sem
// este guard, todo preview de PR rodava `migrate deploy` contra o banco de
// prod — e uma migration quebrada num PR travava os deploys de produção ANTES
// do merge (incidente 2026-07-14; ver memória project_clicksign_multitenant).
//
// Regra: roda a migration quando VERCEL_ENV=production (deploy de prod do
// projeto), OU localmente (VERCEL_ENV ausente — build no dev), OU quando
// FORCE_MIGRATE=1 (escape hatch). Em preview/development do Vercel, PULA.
import { execSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV; // production | preview | development | undefined(local)
const force = process.env.FORCE_MIGRATE === "1";

const shouldMigrate = force || !vercelEnv || vercelEnv === "production";

if (!shouldMigrate) {
  console.log(
    `[migrate] VERCEL_ENV=${vercelEnv} → pulando \`prisma migrate deploy\` (ambiente não-produção; evita migrar o banco de prod em preview de PR).`
  );
  process.exit(0);
}

console.log(
  `[migrate] VERCEL_ENV=${vercelEnv ?? "(local)"}${force ? " (FORCE_MIGRATE=1)" : ""} → rodando \`prisma migrate deploy\`.`
);
execSync("prisma migrate deploy", { stdio: "inherit" });
