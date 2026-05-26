/**
 * Concede (ou atualiza) uma PlatformRole de plataforma a um usuário.
 * Identidade cross-tenant de staff — ver lib/security/rbac/platform.ts.
 *
 * Uso:
 *   npx tsx scripts/grant-platform-role.ts olavo.piton@gmail.com super_admin            # dry-run
 *   npx tsx scripts/grant-platform-role.ts olavo.piton@gmail.com super_admin --apply
 *   ... --scope impersonate,configure_taxes,audit_query --apply
 *   npx tsx scripts/grant-platform-role.ts <email> --revoke --apply                     # remove a role
 *
 * Dry-run é o default — sem --apply nada é escrito.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VALID_ROLES = ["super_admin", "support", "billing"] as const;
type RoleName = (typeof VALID_ROLES)[number];

function opt(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  // Positionais: [email] [role?]. Flags começam com "--".
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const email = positional[0];
  const role = positional[1] as RoleName | undefined;
  const apply = flag("--apply");
  const revoke = flag("--revoke");
  const scope = (opt("--scope") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!email) {
    console.error("❌ Uso: grant-platform-role.ts <email> <role> [--scope a,b] [--apply] | <email> --revoke --apply");
    process.exit(1);
  }
  if (!revoke && (!role || !VALID_ROLES.includes(role))) {
    console.error(`❌ role inválida. Use uma de: ${VALID_ROLES.join(" | ")} (ou --revoke)`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });
  if (!user) {
    console.error(`❌ Usuário ${email} não encontrado`);
    process.exit(1);
  }

  const existing = await prisma.platformRole.findUnique({ where: { userId: user.id } });

  console.log(`\n🔑 Platform role`);
  console.log(`   user:    ${user.email} (${user.id})`);
  console.log(`   atual:   ${existing ? `${existing.role} [${existing.scope.join(", ")}]` : "(nenhuma)"}`);
  console.log(`   ação:    ${revoke ? "REVOKE" : `grant ${role}${scope.length ? ` [${scope.join(", ")}]` : ""}`}`);
  console.log(`   apply:   ${apply}\n`);

  if (!apply) {
    console.log("ℹ Dry-run — re-execute com --apply pra persistir.");
    return;
  }

  if (revoke) {
    if (!existing) {
      console.log("ℹ Nada a revogar (user não tinha platform role).");
      return;
    }
    await prisma.platformRole.delete({ where: { userId: user.id } });
    console.log("✅ Platform role revogada.");
    return;
  }

  const saved = await prisma.platformRole.upsert({
    where: { userId: user.id },
    update: { role: role!, scope },
    create: { userId: user.id, role: role!, scope },
  });
  console.log(`✅ ${existing ? "Atualizada" : "Concedida"}: ${saved.role} [${saved.scope.join(", ")}]`);
}

main()
  .catch((err) => {
    console.error("❌ Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
