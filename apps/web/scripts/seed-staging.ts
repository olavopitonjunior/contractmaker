/**
 * Seed inicial pra Neon branch `staging`. Cria 1 org demo + owner + dados
 * mínimos pra testar fluxos de Locação (imóveis, contratos, cobranças, etc).
 *
 * Idempotente: skip se org já existe. Pra wipe + re-seed use
 * `reset-staging.ts` antes.
 *
 * Usage:
 *   pnpm tsx scripts/seed-staging.ts --apply
 *
 * Env: DATABASE_URL aponta pra Neon branch staging.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const STAGING_OWNER_EMAIL = "olavo.piton@gmail.com";
const STAGING_DEMO_PASSWORD = "staging123"; // documentado em docs/staging-workflow.md
const DEMO_ORG_SUBDOMAIN = "demo";

async function main() {
  console.log(`[seed-staging] ${apply ? "APPLY" : "DRY RUN"}`);

  // 1. Org demo
  const existing = await prisma.organization.findUnique({ where: { subdomain: DEMO_ORG_SUBDOMAIN } });
  if (existing) {
    console.log(`[seed-staging] org subdomain=${DEMO_ORG_SUBDOMAIN} já existe (id=${existing.id}) — skip`);
    if (!apply) return;
    return;
  }

  if (!apply) {
    console.log("[seed-staging] criaria: 1 org, 1 owner, 5 imóveis, 3 contratos, 12 cobranças, 2 fornecedores, 1 fiador, 1 vistoriador, 2 apólices");
    return;
  }

  const passwordHash = await bcrypt.hash(STAGING_DEMO_PASSWORD, 10);
  const owner = await prisma.user.upsert({
    where: { email: STAGING_OWNER_EMAIL },
    update: {},
    create: {
      email: STAGING_OWNER_EMAIL,
      name: "Olavo Piton (staging owner)",
      passwordHash,
    },
  });
  console.log(`[seed-staging] owner: ${owner.email}`);

  const org = await prisma.organization.create({
    data: {
      name: "Contractmaker Demo",
      slug: "contractmaker-demo",
      subdomain: DEMO_ORG_SUBDOMAIN,
      members: {
        create: { userId: owner.id, role: "owner" },
      },
    },
  });
  console.log(`[seed-staging] org: ${org.name} (${org.id})`);

  // 2. Pipeline default (precisa pra Deal funcionar)
  const pipeline = await prisma.pipeline.create({
    data: {
      orgId: org.id,
      name: "Vendas",
      stages: {
        create: [
          { name: "Formulário", position: 0, color: "indigo" },
          { name: "Confecção de Contrato", position: 1, color: "amber" },
          { name: "Enviado para assinatura", position: 2, color: "blue" },
          { name: "Contrato assinado", position: 3, color: "sky" },
          { name: "Cobrança emitida", position: 4, color: "purple" },
          { name: "Comissão paga", position: 5, color: "green" },
          { name: "Negócio perdido", position: 6, color: "red" },
        ],
      },
    },
  });
  console.log(`[seed-staging] pipeline com 7 stages criada`);

  // 3. Proprietários
  const owner1 = await prisma.propertyOwner.create({
    data: {
      orgId: org.id,
      nome: "Maria Silva (demo)",
      cpfCnpj: "999.999.999-99",
      tipoPessoa: "fisica",
      email: "maria@staging.imobpro.ia.br",
    },
  });
  const owner2 = await prisma.propertyOwner.create({
    data: {
      orgId: org.id,
      nome: "João Souza (demo)",
      cpfCnpj: "888.888.888-88",
      tipoPessoa: "fisica",
      email: "joao@staging.imobpro.ia.br",
    },
  });
  // Fornecedores: tipoPessoa=juridica + dataJson.role pra distinguir
  await prisma.propertyOwner.createMany({
    data: [
      { orgId: org.id, nome: "Fornecedor Elétrica Demo", cpfCnpj: "99.999.999/0001-99", tipoPessoa: "juridica", dataJson: { role: "fornecedor" } },
      { orgId: org.id, nome: "Fornecedor Hidráulica Demo", cpfCnpj: "88.888.888/0001-88", tipoPessoa: "juridica", dataJson: { role: "fornecedor" } },
    ],
  });
  console.log(`[seed-staging] 2 owners + 2 fornecedores`);

  // 4. Inquilinos
  const tenant1 = await prisma.tenant.create({
    data: {
      orgId: org.id,
      nome: "Carlos Inquilino (demo)",
      cpfCnpj: "***.***.***-77",
      email: "carlos@staging.imobpro.ia.br",
    },
  });
  const tenant2 = await prisma.tenant.create({
    data: {
      orgId: org.id,
      nome: "Ana Inquilina (demo)",
      cpfCnpj: "***.***.***-66",
      email: "ana@staging.imobpro.ia.br",
    },
  });
  const tenant3 = await prisma.tenant.create({
    data: {
      orgId: org.id,
      nome: "Pedro Inquilino (demo)",
      cpfCnpj: "***.***.***-55",
      email: "pedro@staging.imobpro.ia.br",
    },
  });
  console.log(`[seed-staging] 3 tenants`);

  // 5. Imóveis (5)
  const props = await Promise.all(
    [
      { rua: "Rua das Flores", numero: "123", bairro: "Jardim Paulista", cidade: "São Paulo", uf: "SP", cep: "01415-000", area: 80, kind: "apartamento", status: "locado", valorAluguelSugerido: 3500 },
      { rua: "Rua Augusta", numero: "456", bairro: "Consolação", cidade: "São Paulo", uf: "SP", cep: "01413-000", area: 120, kind: "apartamento", status: "locado", valorAluguelSugerido: 5500 },
      { rua: "Av. Paulista", numero: "1000", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP", cep: "01310-100", area: 200, kind: "comercial", status: "disponivel", valorAluguelSugerido: 12000 },
      { rua: "Rua Oscar Freire", numero: "200", bairro: "Jardins", cidade: "São Paulo", uf: "SP", cep: "01426-001", area: 95, kind: "apartamento", status: "locado", valorAluguelSugerido: 4500 },
      { rua: "Rua Vergueiro", numero: "789", bairro: "Vila Mariana", cidade: "São Paulo", uf: "SP", cep: "04101-300", area: 60, kind: "casa", status: "manutencao", valorAluguelSugerido: 2800 },
    ].map((p) =>
      prisma.property.create({
        data: { ...p, orgId: org.id },
      })
    )
  );

  // 6. Ownership (cada imóvel 100% pra owner alternado)
  for (let i = 0; i < props.length; i++) {
    await prisma.propertyOwnership.create({
      data: {
        orgId: org.id,
        propertyId: props[i].id,
        ownerId: i % 2 === 0 ? owner1.id : owner2.id,
        percentual: 100,
        tipo: "proprietario_principal",
      },
    });
  }
  console.log(`[seed-staging] 5 imóveis com ownership`);

  // 7. Contratos (3 ativos pros imóveis locados)
  const tenants = [tenant1, tenant2, tenant3];
  const leases = [];
  for (let i = 0; i < 3; i++) {
    const lease = await prisma.leaseContract.create({
      data: {
        orgId: org.id,
        propertyId: props[i === 0 ? 0 : i === 1 ? 1 : 3].id,
        status: "ativo",
        finalidade: i === 0 ? "comercial" : "residencial",
        vigenciaInicio: new Date("2025-01-01"),
        vigenciaFim: new Date("2027-12-31"),
        valorAluguel: i === 0 ? 3500 : i === 1 ? 5500 : 4500,
        valorEncargos: i === 0 ? 450 : i === 1 ? 750 : 600,
        diaVencimento: 5,
        taxaAdminPercent: 10,
        indiceReajuste: "IPCA",
        regimeCobranca: "mes_a_vencer",
        regimeIr: "nao_retem",
        repasseTipo: "mes_a_vencer",
        repasseGarantido: "nao",
        emitirNfse: false,
        tenants: { create: { orgId: org.id, tenantId: tenants[i].id, tipo: "titular" } },
      },
    });
    leases.push(lease);
  }
  console.log(`[seed-staging] 3 contratos`);

  // 8. Cobranças (últimas 4 competências × 3 contratos = 12, mix paga/pendente/atrasada)
  const now = new Date();
  const competencias = [
    new Date(now.getFullYear(), now.getMonth() - 3, 1),
    new Date(now.getFullYear(), now.getMonth() - 2, 1),
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
    new Date(now.getFullYear(), now.getMonth(), 1),
  ];
  for (const lease of leases) {
    for (let i = 0; i < competencias.length; i++) {
      const c = competencias[i];
      const comp = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}`;
      const dueDate = new Date(c.getFullYear(), c.getMonth(), lease.diaVencimento);
      const isPast = dueDate < now;
      const isLast = i === competencias.length - 1;
      const status = isLast ? "pendente" : isPast ? (i === 1 ? "atrasada" : "paga") : "pendente";
      await prisma.rentCharge.create({
        data: {
          orgId: org.id,
          leaseContractId: lease.id,
          competencia: comp,
          dueDate,
          kind: "aluguel",
          valorBase: lease.valorAluguel,
          encargos: lease.valorEncargos,
          status,
          paidAt: status === "paga" ? new Date(dueDate.getTime() - 2 * 24 * 3600_000) : null,
        },
      });
    }
  }
  console.log(`[seed-staging] 12 cobranças (mix paga/pendente/atrasada)`);

  // 9. Apólice de seguro (1 por contrato, 2 totais)
  for (let i = 0; i < 2; i++) {
    await prisma.insurancePolicy.create({
      data: {
        orgId: org.id,
        leaseContractId: leases[i].id,
        propertyId: leases[i].propertyId,
        tipo: "seguro_incendio",
        seguradora: "Tokio Marine (demo)",
        apoliceNumero: `APO-${i + 1}-${Date.now()}`,
        vigenciaInicio: new Date("2025-01-01"),
        vigenciaFim: new Date("2025-12-31"),
        premioMensal: 80,
        responsavelPagamento: "locatario",
        status: "ativa",
      },
    });
  }
  console.log(`[seed-staging] 2 apólices`);

  console.log(`[seed-staging] ✓ done. Login: ${STAGING_OWNER_EMAIL} / ${STAGING_DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
