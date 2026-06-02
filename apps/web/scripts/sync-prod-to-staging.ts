/**
 * Sync de dados de prod → staging com anonimização LGPD obrigatória.
 *
 * Lê de DATABASE_URL_PROD (read-only recomendado) e grava em DATABASE_URL.
 * Copia orgs ativas nos últimos N dias (default 90). Mascara CPF/email/phone
 * em todas as entidades sensíveis. Idempotente via upsert.
 *
 * Usage:
 *   STAGING_MODE=true \
 *   DATABASE_URL_PROD=<prod-readonly-url> \
 *   DATABASE_URL=<staging-url> \
 *   pnpm tsx scripts/sync-prod-to-staging.ts --apply --since=90
 *
 * Flags:
 *   --apply              executa de fato (sem flag = dry run)
 *   --since=<dias>       filtra orgs criadas/atualizadas nos últimos N dias (default 90)
 *   --org=<orgId>        sincroniza só essa org
 *
 * Pula intencionalmente: AuditLog, AIUsage, AsaasWebhookEvent (histórico
 * volumoso e não-essencial pra QA).
 */
import { PrismaClient as PrismaProdClient } from "@prisma/client";
import { PrismaClient as PrismaStagingClient } from "@prisma/client";
import bcrypt from "bcryptjs";

if (process.env.STAGING_MODE !== "true") {
  console.error("[sync-prod-to-staging] STAGING_MODE != true — recusando");
  process.exit(1);
}
if (!process.env.DATABASE_URL_PROD) {
  console.error("[sync-prod-to-staging] DATABASE_URL_PROD env obrigatório");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1];
const orgArg = process.argv.find((a) => a.startsWith("--org="))?.split("=")[1];
const sinceDays = sinceArg ? Number(sinceArg) : 90;

const prod = new PrismaProdClient({
  datasources: { db: { url: process.env.DATABASE_URL_PROD } },
});
const staging = new PrismaStagingClient();

// ----- Anonimização -----

function maskCpf(v: string | null | undefined): string {
  if (!v) return "***.***.***-00";
  return v.replace(/\d(?=\d{2})/g, "*");
}
function maskEmail(_v: string | null | undefined, userId: string): string {
  return `user${userId.slice(0, 8)}@staging.imobpro.ia.br`;
}
function maskPhone(v: string | null | undefined): string {
  if (!v) return "";
  return v.replace(/\d(?=\d{4})/g, "*");
}

/**
 * Walker recursivo de JSON: mascara campos sensíveis encontrados.
 * Aplica em dataJson de SalesForm, LeaseContract, Contract, etc.
 */
function maskJsonSensitive(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskJsonSensitive);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (typeof value === "string") {
      if (k === "cpf" || k === "cpfcnpj" || k === "cnpj") {
        out[key] = maskCpf(value);
      } else if (k === "email") {
        out[key] = `user***@staging.imobpro.ia.br`;
      } else if (k === "telefone" || k === "phone" || k === "celular") {
        out[key] = maskPhone(value);
      } else {
        out[key] = value;
      }
    } else {
      out[key] = maskJsonSensitive(value);
    }
  }
  return out;
}

// ----- Filtros -----

const cutoff = new Date(Date.now() - sinceDays * 24 * 3600_000);
const orgFilter = orgArg ? { id: orgArg } : { OR: [{ createdAt: { gte: cutoff } }, { updatedAt: { gte: cutoff } }] };

async function main() {
  console.log(`[sync] ${apply ? "APPLY" : "DRY RUN"} — orgs since=${sinceDays}d`);

  const orgs = await prod.organization.findMany({ where: orgFilter });
  console.log(`[sync] ${orgs.length} orgs candidatas`);

  let copiedUsers = 0;
  let copiedProps = 0;
  let copiedLeases = 0;
  let copiedCharges = 0;

  const stagingPasswordHash = await bcrypt.hash("staging123", 10);

  for (const org of orgs) {
    console.log(`\n[sync] org: ${org.name} (${org.id})`);

    if (apply) {
      await staging.organization.upsert({
        where: { id: org.id },
        update: { name: `${org.name} (staging)`, slug: org.slug, subdomain: org.subdomain ?? undefined },
        create: { ...org, name: `${org.name} (staging)`, customDomain: null },
      });
    }

    // Users via OrgMembership
    const memberships = await prod.orgMembership.findMany({
      where: { orgId: org.id },
      include: { user: true },
    });
    for (const m of memberships) {
      if (apply) {
        await staging.user.upsert({
          where: { id: m.user.id },
          update: {
            email: maskEmail(m.user.email, m.user.id),
            name: m.user.name,
            passwordHash: stagingPasswordHash,
          },
          create: {
            id: m.user.id,
            email: maskEmail(m.user.email, m.user.id),
            name: m.user.name,
            passwordHash: stagingPasswordHash,
          },
        });
        await staging.orgMembership.upsert({
          where: { id: m.id },
          update: { role: m.role },
          create: { id: m.id, orgId: m.orgId, userId: m.userId, role: m.role },
        });
      }
      copiedUsers++;
    }

    // Properties
    const properties = await prod.property.findMany({ where: { orgId: org.id } });
    for (const p of properties) {
      if (apply) {
        await staging.property.upsert({
          where: { id: p.id },
          update: { ...p, dataJson: p.dataJson ? (maskJsonSensitive(p.dataJson) as object) : null as never },
          create: { ...p, dataJson: p.dataJson ? (maskJsonSensitive(p.dataJson) as object) : null as never },
        });
      }
      copiedProps++;
    }

    // PropertyOwner (mascarar CPF/email)
    const owners = await prod.propertyOwner.findMany({ where: { orgId: org.id } });
    for (const o of owners) {
      if (apply) {
        await staging.propertyOwner.upsert({
          where: { id: o.id },
          update: {
            nome: o.nome,
            cpfCnpj: maskCpf(o.cpfCnpj),
            email: o.email ? maskEmail(o.email, o.id) : null,
            telefone: o.telefone ? maskPhone(o.telefone) : null,
            tipo: o.tipo,
          },
          create: {
            id: o.id,
            orgId: o.orgId,
            nome: o.nome,
            cpfCnpj: maskCpf(o.cpfCnpj),
            email: o.email ? maskEmail(o.email, o.id) : null,
            telefone: o.telefone ? maskPhone(o.telefone) : null,
            tipo: o.tipo,
          },
        });
      }
    }

    // Tenant
    const tenants = await prod.tenant.findMany({ where: { orgId: org.id } });
    for (const t of tenants) {
      if (apply) {
        await staging.tenant.upsert({
          where: { id: t.id },
          update: {
            nome: t.nome,
            cpfCnpj: maskCpf(t.cpfCnpj),
            email: t.email ? maskEmail(t.email, t.id) : null,
            telefone: t.telefone ? maskPhone(t.telefone) : null,
          },
          create: {
            id: t.id,
            orgId: t.orgId,
            nome: t.nome,
            cpfCnpj: maskCpf(t.cpfCnpj),
            email: t.email ? maskEmail(t.email, t.id) : null,
            telefone: t.telefone ? maskPhone(t.telefone) : null,
          },
        });
      }
    }

    // LeaseContract (dataJson mascarado)
    const leases = await prod.leaseContract.findMany({ where: { orgId: org.id } });
    for (const l of leases) {
      if (apply) {
        await staging.leaseContract.upsert({
          where: { id: l.id },
          update: { ...l, dataJson: l.dataJson ? (maskJsonSensitive(l.dataJson) as object) : null as never },
          create: { ...l, dataJson: l.dataJson ? (maskJsonSensitive(l.dataJson) as object) : null as never },
        });
      }
      copiedLeases++;
    }

    // RentCharge (sem PII)
    const charges = await prod.rentCharge.findMany({ where: { orgId: org.id } });
    for (const c of charges) {
      if (apply) {
        await staging.rentCharge.upsert({
          where: { id: c.id },
          update: c,
          create: c,
        });
      }
      copiedCharges++;
    }
  }

  console.log(`\n[sync] summary: ${orgs.length} orgs, ${copiedUsers} users, ${copiedProps} properties, ${copiedLeases} leases, ${copiedCharges} charges`);
  console.log(`[sync] ${apply ? "✓ applied" : "(dry run — pass --apply to commit)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prod.$disconnect();
    await staging.$disconnect();
  });
