/**
 * Promove (ou corrige) o papel de um membro da org — caso Márcia 2026-08:
 * `OrgMembership.role` é String livre e qualquer valor fora do catálogo de
 * ROLE_PRESETS (ex.: o legado "member", default do signup) resolve pra ZERO
 * permissões — o usuário vê as páginas "não abrirem" sem nenhuma mensagem.
 *
 * Uso (DATABASE_URL do ambiente decide o banco — pra prod, injete via 1Password):
 *   npx tsx apps/web/scripts/promote-member-role.ts --search=marcia                        # lista (read-only)
 *   npx tsx apps/web/scripts/promote-member-role.ts --email=x@y.com --role=admin           # dry-run
 *   npx tsx apps/web/scripts/promote-member-role.ts --email=x@y.com --role=admin --apply   # executa
 *
 * Idempotente: se o role já é o pedido, não escreve nada.
 */

import fs from "fs";
import path from "path";
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
import { ROLE_PRESETS } from "../src/lib/security/rbac/roles";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const email = arg("email");
  const search = arg("search");
  const role = arg("role") ?? "admin";
  const apply = process.argv.includes("--apply");

  // Modo busca (read-only): lista membros por nome/e-mail parcial.
  if (search) {
    const rows = await prisma.orgMembership.findMany({
      where: {
        user: {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        },
      },
      include: {
        user: { select: { email: true, name: true } },
        org: { select: { id: true, name: true } },
      },
    });
    if (rows.length === 0) {
      console.log(`Nenhum membro casa com "${search}"`);
      return;
    }
    for (const m of rows) {
      console.log(
        `${m.user.email}  nome="${m.user.name ?? ""}"  role="${m.role}"  org=${m.org.name} (${m.org.id})`
      );
    }
    return;
  }

  if (!email) {
    console.error("Uso: --search=<trecho> | --email=<email> [--role=admin] [--apply]");
    process.exit(1);
  }
  if (!(role in ROLE_PRESETS)) {
    console.error(
      `Role "${role}" fora do catálogo. Válidos: ${Object.keys(ROLE_PRESETS).join(", ")}`
    );
    process.exit(1);
  }

  const memberships = await prisma.orgMembership.findMany({
    where: { user: { email: { equals: email, mode: "insensitive" } } },
    include: {
      user: { select: { email: true, name: true } },
      org: { select: { id: true, name: true } },
    },
  });
  if (memberships.length === 0) {
    console.error(`Nenhuma OrgMembership encontrada para ${email}`);
    process.exit(1);
  }

  for (const m of memberships) {
    const line = `${m.user.email} @ ${m.org.name} (${m.org.id}): role="${m.role}"`;
    if (m.role === role) {
      console.log(`OK    ${line} — já é "${role}", nada a fazer`);
      continue;
    }
    if (!apply) {
      console.log(`DRY   ${line} → "${role}" (rode com --apply)`);
      continue;
    }
    await prisma.orgMembership.update({ where: { id: m.id }, data: { role } });
    console.log(`FEITO ${line} → "${role}"`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
