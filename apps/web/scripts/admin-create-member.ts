/**
 * Cria conta de membro diretamente no banco, sem depender de email.
 *
 * Caso de uso: enquanto o domínio de envio (Resend) não estiver verificado,
 * o approver não consegue entregar magic link / welcome link via email. Este
 * script cria o User com uma senha temporária e marca qualquer OrgInvitation
 * pendente do email como aprovado. O approver então passa email+senha para o
 * convidado por outro canal (WhatsApp etc.) e ele troca pela própria depois.
 *
 * Uso:
 *   npx tsx scripts/admin-create-member.ts \
 *     --email pessoa@exemplo.com \
 *     --name "Nome Completo" \
 *     --role admin
 *
 * Flags:
 *   --email     (obrigatório)
 *   --name      (opcional; se ausente, herda do invitation pendente, se houver)
 *   --role      member|admin|finance|sales|viewer  (default: member)
 *   --org-id    (opcional; default: env SHARED_ORG_ID)
 *   --password  (opcional; default: gerada e impressa)
 *   --dry-run   (mostra o que faria sem gravar)
 *
 * Env: DATABASE_URL
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const ROLE_VALUES = ["member", "admin", "finance", "sales", "viewer"] as const;
type Role = (typeof ROLE_VALUES)[number];

interface Args {
  email: string;
  name?: string;
  role: Role;
  orgId: string;
  password?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const email = get("--email")?.toLowerCase().trim();
  if (!email) throw new Error("--email é obrigatório");
  const role = (get("--role") ?? "member") as Role;
  if (!ROLE_VALUES.includes(role)) {
    throw new Error(`--role inválido: ${role}. Use: ${ROLE_VALUES.join(", ")}`);
  }
  const orgId = get("--org-id") ?? process.env.SHARED_ORG_ID;
  if (!orgId) throw new Error("--org-id ausente e SHARED_ORG_ID não setado");
  return {
    email,
    name: get("--name"),
    role,
    orgId,
    password: get("--password"),
    dryRun: argv.includes("--dry-run"),
  };
}

function generatePassword(): string {
  return `${randomBytes(8).toString("base64url")}!9`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  const org = await prisma.organization.findUnique({
    where: { id: args.orgId },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`Org ${args.orgId} não encontrada`);

  const existingUser = await prisma.user.findUnique({
    where: { email: args.email },
    select: { id: true, name: true, passwordHash: true },
  });

  const pendingInvite = await prisma.orgInvitation.findFirst({
    where: { email: args.email, orgId: args.orgId, status: "pending" },
    select: { id: true, name: true, role: true },
  });

  const inviteRole = pendingInvite?.role as Role | undefined;
  const finalRole = args.role ?? inviteRole ?? "member";
  const finalName = args.name ?? pendingInvite?.name ?? existingUser?.name ?? null;
  const password = args.password ?? generatePassword();

  console.log(JSON.stringify(
    {
      action: existingUser ? "update" : "create",
      email: args.email,
      name: finalName,
      role: finalRole,
      org: { id: org.id, name: org.name },
      pendingInviteId: pendingInvite?.id ?? null,
      passwordSource: args.password ? "supplied" : "generated",
    },
    null,
    2
  ));

  if (args.dryRun) {
    console.log("\n[dry-run] Senha que seria definida:", password);
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.$transaction(async (tx) => {
    let userId: string;
    if (existingUser) {
      await tx.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash,
          ...(finalName && !existingUser.name ? { name: finalName } : {}),
        },
      });
      userId = existingUser.id;
    } else {
      const created = await tx.user.create({
        data: {
          email: args.email,
          name: finalName,
          passwordHash,
          emailVerified: new Date(),
        },
        select: { id: true },
      });
      userId = created.id;
    }

    const existingMembership = await tx.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: org.id } },
      select: { id: true, role: true },
    });

    if (!existingMembership) {
      await tx.orgMembership.create({
        data: {
          userId,
          orgId: org.id,
          role: finalRole,
        },
      });
    } else if (existingMembership.role !== finalRole) {
      await tx.orgMembership.update({
        where: { id: existingMembership.id },
        data: { role: finalRole },
      });
    }

    if (pendingInvite) {
      await tx.orgInvitation.update({
        where: { id: pendingInvite.id },
        data: {
          status: "approved",
          approvedAt: new Date(),
        },
      });
    }
  });

  console.log("\n=========================================");
  console.log("CONTA CRIADA / ATUALIZADA");
  console.log("=========================================");
  console.log("Email:  ", args.email);
  console.log("Senha:  ", password);
  console.log("Role:   ", finalRole);
  console.log("Org:    ", org.name);
  console.log("Login:  ", `${process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br"}/login`);
  console.log("=========================================");
  console.log("Passe email+senha para o usuário por canal seguro (WhatsApp,");
  console.log("ligação). Ele pode trocar pela própria senha depois via");
  console.log("/forgot-password (quando o envio de email estiver funcional).");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
