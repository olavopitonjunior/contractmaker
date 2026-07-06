/**
 * Remove os dados de teste criados por seed-dimob-e2e.ts (marcador Property
 * matricula = "MAT-DIMOB-E2E"). Não há rota/cascade completa para locação, então
 * apaga em ordem segura via Prisma. Idempotente; confere contagens zeradas.
 *
 * Uso: DATABASE_URL=<staging> pnpm tsx apps/web/scripts/cleanup-dimob-e2e.ts \
 *        --apply --orgId=<org>
 * (sem --apply = dry-run: só conta o que apagaria)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const TARGET_ORG = arg("orgId") ?? process.env.SHARED_ORG_ID;

const MARKER = "MAT-DIMOB-E2E";
const OWNER_CPF = "390.533.447-05";
const TENANT_CPF = "111.444.777-35";

async function main() {
  if (!TARGET_ORG) throw new Error("Passe --orgId=<id> ou SHARED_ORG_ID");
  console.log(`[cleanup-dimob-e2e] ${APPLY ? "APPLY" : "DRY-RUN"} org=${TARGET_ORG}`);

  const properties = await prisma.property.findMany({
    where: { orgId: TARGET_ORG, matricula: MARKER },
    select: { id: true },
  });
  const propertyIds = properties.map((p) => p.id);
  if (propertyIds.length === 0) {
    console.log("Nada a limpar (nenhuma Property com o marcador).");
    return;
  }
  const leases = await prisma.leaseContract.findMany({
    where: { orgId: TARGET_ORG, propertyId: { in: propertyIds } },
    select: { id: true },
  });
  const leaseIds = leases.map((l) => l.id);
  console.log(`Encontrado: ${propertyIds.length} imóvel(is), ${leaseIds.length} contrato(s).`);

  if (!APPLY) {
    console.log("(dry-run — sem deleção)");
    return;
  }

  // 1) dependências sem cascade a partir do lease/property
  await prisma.expense.deleteMany({ where: { OR: [{ leaseContractId: { in: leaseIds } }, { propertyId: { in: propertyIds } }] } });
  await prisma.checklist.deleteMany({ where: { leaseContractId: { in: leaseIds } } });
  await prisma.insurancePolicy.deleteMany({ where: { OR: [{ leaseContractId: { in: leaseIds } }, { propertyId: { in: propertyIds } }] } });
  await prisma.inspection.deleteMany({ where: { OR: [{ leaseContractId: { in: leaseIds } }, { propertyId: { in: propertyIds } }] } });

  // 2) lease → cascade em RentCharge / LeaseTenant / Guarantee
  const delLeases = await prisma.leaseContract.deleteMany({ where: { id: { in: leaseIds } } });

  // 3) property → cascade em PropertyOwnership
  const delProps = await prisma.property.deleteMany({ where: { id: { in: propertyIds } } });

  // 4) owner/tenant de teste — só se não sobraram vínculos (evita apagar dado real que compartilhe doc)
  const owner = await prisma.propertyOwner.findFirst({ where: { orgId: TARGET_ORG, cpfCnpj: OWNER_CPF }, select: { id: true, _count: { select: { ownerships: true } } } });
  if (owner && owner._count.ownerships === 0) await prisma.propertyOwner.delete({ where: { id: owner.id } });
  const tenant = await prisma.tenant.findFirst({ where: { orgId: TARGET_ORG, cpfCnpj: TENANT_CPF }, select: { id: true, _count: { select: { leaseTenants: true } } } });
  if (tenant && tenant._count.leaseTenants === 0) await prisma.tenant.delete({ where: { id: tenant.id } });

  // 5) confere resíduo
  const remainingProp = await prisma.property.count({ where: { orgId: TARGET_ORG, matricula: MARKER } });
  const remainingCharges = await prisma.rentCharge.count({ where: { leaseContractId: { in: leaseIds } } });

  console.log(
    `✅ Removido: ${delLeases.count} contrato(s), ${delProps.count} imóvel(is), owner/tenant de teste.\n` +
      `Resíduo: properties=${remainingProp}, rentCharges=${remainingCharges} (esperado 0/0).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
