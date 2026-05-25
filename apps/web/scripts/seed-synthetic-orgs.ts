/**
 * Seed de orgs sintéticas pra testes de isolamento multi-tenant + E2E two-org.
 *
 * Cria N orgs (default 2: "alpha", "beta") cada uma com:
 *   - Organization + owner User (login real, senha conhecida) + OrgMembership(owner)
 *   - Pipeline com os 7 stages canônicos
 *   - M deals espalhados pelos stages + L leads + 1 contrato (rascunho, templateId=null)
 *   - 1 AsaasAccount placeholder (status APPROVED, chave NÃO-real)
 *   - alguns AuditLogs de amostra
 *
 * Idempotente: tudo usa ids determinísticos `seed_<slug>_*` + upsert. Re-rodar
 * não duplica. Fixture base do `tenant-isolation.test.ts` (Fase 0b) e do E2E
 * two-org (Fase 1a/1e). Ver docs/kickoff-multitenant-fase0.md.
 *
 * Uso:
 *   npx tsx scripts/seed-synthetic-orgs.ts                 # dry-run (não escreve)
 *   SYNTHETIC_SEED_ALLOWED=1 npx tsx scripts/seed-synthetic-orgs.ts --apply
 *   ... --orgs 3 --deals 5 --leads 2 --password "minha-senha"
 *
 * Segurança (anti-prod):
 *   - Dry-run é o default — sem --apply, nada é escrito.
 *   - --apply RECUSA rodar se NODE_ENV=production OU se SYNTHETIC_SEED_ALLOWED!=1.
 *     Setar SYNTHETIC_SEED_ALLOWED=1 SÓ no .env.staging (nunca em prod).
 *   - Imprime o host do DATABASE_URL antes de qualquer escrita pra conferência.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}
function intArg(name: string, fallback: number): number {
  const raw = arg(name);
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const APPLY = flag("--apply");
const ORG_COUNT = intArg("--orgs", 2);
const DEALS_PER_ORG = intArg("--deals", 3);
const LEADS_PER_ORG = intArg("--leads", 2);
const PASSWORD = arg("--password") ?? "synthetic-seed-123";

const SLUGS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];

// 7 stages canônicos (espelha scripts/migrate-pipeline-stages.ts).
const STAGES: { name: string; color: string; position: number }[] = [
  { name: "Formulário", color: "#6366f1", position: 0 },
  { name: "Confecção de Contrato", color: "#f59e0b", position: 1 },
  { name: "Enviado para assinatura", color: "#3b82f6", position: 2 },
  { name: "Contrato assinado", color: "#0ea5e9", position: 3 },
  { name: "Cobrança emitida", color: "#a855f7", position: 4 },
  { name: "Comissão paga", color: "#22c55e", position: 5 },
  { name: "Negócio perdido", color: "#ef4444", position: 6 },
];

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(sem host)";
  } catch {
    return "(DATABASE_URL não-parseável)";
  }
}

function syntheticDealData(slug: string, n: number) {
  return {
    vendedores: [{ nome: `Vendedor ${slug.toUpperCase()} ${n}`, cpf: "000.000.000-00" }],
    compradores: [{ nome: `Comprador ${slug.toUpperCase()} ${n}`, cpf: "111.111.111-11" }],
    imoveis: [{ endereco: `Rua Sintética ${n}, ${slug}`, cidade: "São Paulo", uf: "SP" }],
    pagamento: { valor_total: 500000 + n * 10000, modalidade: n % 2 === 0 ? "a_vista" : "financiamento" },
  };
}

async function seedOrg(index: number) {
  const slug = SLUGS[index] ?? `org${index + 1}`;
  const p = (suffix: string) => `seed_${slug}_${suffix}`;
  const ownerEmail = `owner@${slug}.seed.local`;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  if (!APPLY) {
    console.log(`  [dry-run] org "${slug}": Organization + owner(${ownerEmail}) + pipeline(7 stages) + ${DEALS_PER_ORG} deals + ${LEADS_PER_ORG} leads + 1 contrato + 1 AsaasAccount + audits`);
    return { slug, ownerEmail };
  }

  // Organization
  await prisma.organization.upsert({
    where: { id: p("org") },
    update: { name: `Imobiliária ${slug}` },
    create: { id: p("org"), name: `Imobiliária ${slug}`, slug: `${slug}-seed` },
  });

  // Owner user
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: { name: `Owner ${slug}`, passwordHash },
    create: { id: p("owner"), email: ownerEmail, name: `Owner ${slug}`, passwordHash, role: "user" },
  });

  // Membership (owner)
  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: owner.id, orgId: p("org") } },
    update: { role: "owner" },
    create: { userId: owner.id, orgId: p("org"), role: "owner" },
  });

  // Pipeline + stages
  await prisma.pipeline.upsert({
    where: { id: p("pipeline") },
    update: {},
    create: { id: p("pipeline"), orgId: p("org"), name: "Pipeline Principal" },
  });
  for (const s of STAGES) {
    await prisma.pipelineStage.upsert({
      where: { pipelineId_position: { pipelineId: p("pipeline"), position: s.position } },
      update: { name: s.name, color: s.color },
      create: { id: p(`stage_${s.position}`), pipelineId: p("pipeline"), name: s.name, color: s.color, position: s.position },
    });
  }

  // Deals — espalhados pelos primeiros stages
  for (let n = 1; n <= DEALS_PER_ORG; n++) {
    const stagePos = (n - 1) % STAGES.length;
    await prisma.deal.upsert({
      where: { id: p(`deal_${n}`) },
      update: { title: `Negócio ${slug} #${n}` },
      create: {
        id: p(`deal_${n}`),
        pipelineId: p("pipeline"),
        stageId: p(`stage_${stagePos}`),
        userId: owner.id,
        title: `Negócio ${slug} #${n}`,
        value: 500000 + n * 10000,
        dataJson: syntheticDealData(slug, n),
        position: n,
      },
    });
  }

  // Leads
  for (let n = 1; n <= LEADS_PER_ORG; n++) {
    await prisma.lead.upsert({
      where: { id: p(`lead_${n}`) },
      update: { title: `Lead ${slug} #${n}` },
      create: {
        id: p(`lead_${n}`),
        orgId: p("org"),
        userId: owner.id,
        title: `Lead ${slug} #${n}`,
        status: "open",
        phones: [`+55119${index}${n}000000`.slice(0, 14)],
      },
    });
  }

  // 1 contrato no deal #1 (importado: templateId=null)
  await prisma.contract.upsert({
    where: { id: p("contract_1") },
    update: {},
    create: {
      id: p("contract_1"),
      dealId: p("deal_1"),
      templateId: null,
      userId: owner.id,
      dataJson: syntheticDealData(slug, 1),
      status: "rascunho",
    },
  });

  // AsaasAccount placeholder (chave NÃO-real; status APPROVED p/ telas financeiras)
  await prisma.asaasAccount.upsert({
    where: { id: p("asaas") },
    update: { status: "APPROVED" },
    create: {
      id: p("asaas"),
      orgId: p("org"),
      label: `Conta ${slug}`,
      asaasId: p("asaasid"),
      walletId: p("wallet"),
      apiKeyEncrypted: "seed-placeholder-not-a-real-key",
      apiKeyIvBase64: "c2VlZC1pdg==",
      apiKeyTagBase64: "c2VlZC10YWc=",
      personType: "LEGAL",
      kyc: { synthetic: true },
      status: "APPROVED",
      generalStatus: "APPROVED",
      approvedAt: new Date(),
    },
  });

  // AuditLogs de amostra
  const auditActions = ["DEAL_CREATE", "CONTRACT_CREATE", "USER_LOGIN"];
  for (let i = 0; i < auditActions.length; i++) {
    await prisma.auditLog.upsert({
      where: { id: p(`audit_${i}`) },
      update: {},
      create: {
        id: p(`audit_${i}`),
        orgId: p("org"),
        userId: owner.id,
        action: auditActions[i],
        result: "SUCCESS",
        resourceType: auditActions[i].split("_")[0].toLowerCase(),
        metadata: { synthetic: true, seq: i },
      },
    });
  }

  console.log(`  ✓ org "${slug}" (${p("org")}) — owner ${ownerEmail} / senha "${PASSWORD}"`);
  return { slug, ownerEmail };
}

async function main() {
  console.log(`\n🌱 Seed de orgs sintéticas`);
  console.log(`   DB host: ${dbHost()}`);
  console.log(`   orgs=${ORG_COUNT} deals/org=${DEALS_PER_ORG} leads/org=${LEADS_PER_ORG} apply=${APPLY}\n`);

  if (APPLY) {
    if (process.env.NODE_ENV === "production") {
      console.error("❌ NODE_ENV=production — seed sintético é staging-only. Abortando.");
      process.exit(1);
    }
    if (process.env.SYNTHETIC_SEED_ALLOWED !== "1") {
      console.error(
        "❌ --apply bloqueado: setar SYNTHETIC_SEED_ALLOWED=1 (só no .env.staging).\n" +
          "   Confira o 'DB host' acima — NUNCA rode com --apply contra prod."
      );
      process.exit(1);
    }
  }

  const results = [];
  for (let i = 0; i < ORG_COUNT; i++) {
    results.push(await seedOrg(i));
  }

  if (!APPLY) {
    console.log(`\nℹ Dry-run — re-execute com --apply (e SYNTHETIC_SEED_ALLOWED=1) pra persistir.`);
  } else {
    console.log(`\n✅ ${results.length} orgs sintéticas prontas. Logins:`);
    for (const r of results) console.log(`   ${r.ownerEmail}  (senha: ${PASSWORD})`);
  }
}

main()
  .catch((err) => {
    console.error("❌ Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
