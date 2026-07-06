/**
 * Semeia um contrato de locação de TESTE, isolado e com CPF/CNPJ VÁLIDOS, para o
 * E2E da DIMOB R02 no STAGING (o seed-locacao-demo.ts usa docs inválidos que o
 * validate bloqueia, e só 1 mês pago). Cria aluguéis PAGOS em vários meses do ano
 * (única forma de popular o R02 — não há rota que marque pagamento).
 *
 * Marcador de limpeza: Property.matricula = "MAT-DIMOB-E2E". Idempotente.
 *
 * Uso: DATABASE_URL=<staging> pnpm tsx apps/web/scripts/seed-dimob-e2e.ts \
 *        --apply --orgId=<org> [--year=2025]
 * (sem --apply = dry-run)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const TARGET_ORG = arg("orgId") ?? process.env.SHARED_ORG_ID;
const YEAR = Number(arg("year") ?? "2025");

const MARKER = "MAT-DIMOB-E2E";
const OWNER_CPF = "390.533.447-05"; // válido
const TENANT_CPF = "111.444.777-35"; // válido
const PAID_MONTHS = [1, 4, 8, 12]; // meses com aluguel pago no ano

async function main() {
  if (!TARGET_ORG) throw new Error("Passe --orgId=<id> ou SHARED_ORG_ID");
  if (!Number.isInteger(YEAR) || YEAR < 2000 || YEAR > 2100) throw new Error("--year inválido");
  console.log(`[dimob-e2e] ${APPLY ? "APPLY" : "DRY-RUN"} org=${TARGET_ORG} year=${YEAR}`);

  const org = await prisma.organization.findUnique({ where: { id: TARGET_ORG }, select: { id: true, name: true } });
  if (!org) throw new Error("Org não encontrada");
  console.log(`Org: ${org.name ?? org.id}`);
  if (!APPLY) {
    console.log("(dry-run — sem mutações)");
    return;
  }

  const owner = await prisma.propertyOwner.upsert({
    where: { orgId_cpfCnpj: { orgId: org.id, cpfCnpj: OWNER_CPF } },
    update: {},
    create: { orgId: org.id, tipoPessoa: "fisica", nome: "Locador Teste DIMOB", cpfCnpj: OWNER_CPF },
  });
  const tenant = await prisma.tenant.upsert({
    where: { orgId_cpfCnpj: { orgId: org.id, cpfCnpj: TENANT_CPF } },
    update: {},
    create: { orgId: org.id, tipoPessoa: "fisica", nome: "Inquilino Teste DIMOB", cpfCnpj: TENANT_CPF },
  });

  const property =
    (await prisma.property.findFirst({ where: { orgId: org.id, matricula: MARKER }, select: { id: true } })) ??
    (await prisma.property.create({
      data: {
        orgId: org.id,
        kind: "sala_comercial",
        status: "locado",
        rua: "Rua de Teste DIMOB",
        numero: "100",
        bairro: "Centro",
        cidade: "São Paulo",
        uf: "SP",
        cep: "01001-000",
        matricula: MARKER,
        tipoDimob: "urbano",
      },
    }));

  await prisma.propertyOwnership.upsert({
    where: { propertyId_ownerId: { propertyId: property.id, ownerId: owner.id } },
    update: { percentual: 100, tipo: "proprietario_principal" },
    create: { orgId: org.id, propertyId: property.id, ownerId: owner.id, percentual: 100, tipo: "proprietario_principal" },
  });

  const lease =
    (await prisma.leaseContract.findFirst({ where: { orgId: org.id, propertyId: property.id }, select: { id: true } })) ??
    (await prisma.leaseContract.create({
      data: {
        orgId: org.id,
        propertyId: property.id,
        status: "ativo",
        finalidade: "comercial",
        valorAluguel: 3000,
        valorEncargos: 200,
        diaVencimento: 10,
        vigenciaInicio: new Date(Date.UTC(YEAR - 2, 8, 8)),
        vigenciaFim: new Date(Date.UTC(YEAR + 1, 8, 8)),
        taxaAdminPercent: 9,
        regimeIr: "retem_imobiliaria",
        dataJson: { comissao: { numero_contrato: "9001" } },
      },
    }));

  await prisma.leaseTenant.upsert({
    where: { leaseContractId_tenantId: { leaseContractId: lease.id, tenantId: tenant.id } },
    update: { tipo: "titular" },
    create: { orgId: org.id, leaseContractId: lease.id, tenantId: tenant.id, tipo: "titular" },
  });

  for (const m of PAID_MONTHS) {
    const comp = `${YEAR}-${String(m).padStart(2, "0")}`;
    await prisma.rentCharge.upsert({
      where: { leaseContractId_competencia_kind: { leaseContractId: lease.id, competencia: comp, kind: "aluguel" } },
      update: { status: "paga", paidAt: new Date(Date.UTC(YEAR, m - 1, 12)) },
      create: {
        orgId: org.id,
        leaseContractId: lease.id,
        kind: "aluguel",
        competencia: comp,
        dueDate: new Date(Date.UTC(YEAR, m - 1, 10)),
        valorBase: 3000,
        encargos: 200,
        status: "paga",
        paidAt: new Date(Date.UTC(YEAR, m - 1, 12)),
      },
    });
  }

  console.log(
    `✅ Seed E2E: property=${property.id} lease=${lease.id} owner=${owner.id} tenant=${tenant.id}\n` +
      `   ${PAID_MONTHS.length} aluguéis pagos em ${YEAR} (meses ${PAID_MONTHS.join(",")}).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
