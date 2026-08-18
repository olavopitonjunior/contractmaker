/**
 * Redefine a senha de um usuário existente, identificado por e-mail.
 *
 * Caso de uso: resetar a senha de uma conta (ex.: em staging) sem depender do
 * fluxo de e-mail/magic link. Ao contrário de `admin-create-member.ts`, este
 * script NÃO toca em `OrgMembership`/role — então é seguro rodar contra um
 * owner sem rebaixá-lo. Atualiza apenas `User.passwordHash` e invalida as
 * sessões NextAuth ativas (mesmo comportamento de `/api/auth/reset-password`).
 *
 * Uso (DATABASE_URL do ambiente decide o banco — pra prod, injete via 1Password):
 *   npx tsx apps/web/scripts/reset-password.ts --email=x@y.com                   # dry-run (mostra a senha que seria definida)
 *   npx tsx apps/web/scripts/reset-password.ts --email=x@y.com --apply           # executa (senha gerada)
 *   npx tsx apps/web/scripts/reset-password.ts --email=x@y.com --password=... --apply
 *
 * Dry-run por PADRÃO: como o script é destrutivo (troca credencial + derruba
 * sessões), só grava com --apply. Espelha a convenção do promote-member-role.ts.
 */

import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*'?([^']*)'?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}

import { prisma } from "../src/lib/db/prisma";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function generatePassword(): string {
  return `${randomBytes(8).toString("base64url")}!9`;
}

async function main() {
  const email = arg("email")?.toLowerCase().trim();
  const supplied = arg("password");
  const apply = process.argv.includes("--apply");

  if (!email) {
    console.error("Uso: --email=<email> [--password=<min8>] [--apply]");
    process.exit(1);
  }
  if (supplied && supplied.length < 8) {
    console.error("--password deve ter no mínimo 8 caracteres");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    console.error(`Usuário com e-mail ${email} não encontrado neste banco`);
    process.exit(1);
  }

  const password = supplied ?? generatePassword();
  const line = `${user.email} (${user.name ?? "sem nome"}, ${user.id}) — senha ${supplied ? "fornecida" : "gerada"}`;

  if (!apply) {
    console.log(`DRY   ${line} (rode com --apply)`);
    console.log(`      senha que seria definida: ${password}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Invalida sessões NextAuth ativas (DB sessions) — espelha o fluxo oficial de
  // reset (api/auth/reset-password). JWTs já emitidos expiram naturalmente.
  const { count } = await prisma.session
    .deleteMany({ where: { userId: user.id } })
    .catch(() => ({ count: 0 }));

  console.log(`FEITO ${line}`);
  console.log(`      senha: ${password}`);
  console.log(`      sessões invalidadas: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
