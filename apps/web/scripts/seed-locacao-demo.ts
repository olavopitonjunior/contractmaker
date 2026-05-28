// scripts/seed-locacao-demo.ts
// Popula dados de demo de locação na org do usuário (default: a do Olavo).
// 1 PropertyOwner + 1 Tenant + 1 Property (2 owners × 50%) + 1 LeaseContract +
// 1 Checklist Entrada + 3 RentCharges (uma paga, uma pendente, uma atrasada) +
// 2 Expenses + 1 InsurancePolicy + 1 NewtonRequest.
//
// Idempotente: usa upsert por cpfCnpj/competencia onde possível.
//
// Uso:
//   pnpm tsx apps/web/scripts/seed-locacao-demo.ts --apply --orgId=cmnt1ldo4000111bw4yo517k0
//   (sem --apply = dry-run; sem --orgId = SHARED_ORG_ID se setado)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId="));
const TARGET_ORG = ORG_ARG ? ORG_ARG.split("=")[1] : process.env.SHARED_ORG_ID;

async function main() {
  if (!TARGET_ORG) {
    console.error("Pass --orgId=<id> ou setar SHARED_ORG_ID");
    process.exit(1);
  }
  console.log(APPLY ? "[demo] APPLY mode" : "[demo] DRY-RUN — passe --apply");

  const org = await prisma.organization.findUnique({
    where: { id: TARGET_ORG },
    select: { id: true, name: true },
  });
  if (!org) {
    console.error("Org não encontrada");
    process.exit(1);
  }
  console.log(`Org: ${org.name ?? org.id}`);

  if (!APPLY) {
    console.log("(dry-run — sem mutações)");
    await prisma.$disconnect();
    return;
  }

  // PropertyOwner 1 (principal)
  const owner1 = await prisma.propertyOwner.upsert({
    where: { orgId_cpfCnpj: { orgId: org.id, cpfCnpj: "111.111.111-11" } },
    update: {},
    create: {
      orgId: org.id,
      tipoPessoa: "fisica",
      nome: "Maria Aparecida Capelo de Freitas",
      cpfCnpj: "111.111.111-11",
      email: "maria.capelo@example.com",
      phone: "5511988887777",
      pixKey: "111.111.111-11",
      pixKeyType: "CPF",
    },
  });
  // PropertyOwner 2 (50%)
  const owner2 = await prisma.propertyOwner.upsert({
    where: { orgId_cpfCnpj: { orgId: org.id, cpfCnpj: "222.222.222-22" } },
    update: {},
    create: {
      orgId: org.id,
      tipoPessoa: "fisica",
      nome: "José Carlos Capelo",
      cpfCnpj: "222.222.222-22",
    },
  });
  console.log(`✓ Proprietários: ${owner1.nome}, ${owner2.nome}`);

  // Tenant
  const tenant = await prisma.tenant.upsert({
    where: { orgId_cpfCnpj: { orgId: org.id, cpfCnpj: "333.333.333-33" } },
    update: {},
    create: {
      orgId: org.id,
      tipoPessoa: "fisica",
      nome: "Angelo Rodrigues Evangelista",
      cpfCnpj: "333.333.333-33",
      email: "angelo@example.com",
      phone: "5511977776666",
      dataJson: { renda_mensal: 7500, estado_civil: "Solteiro" },
    },
  });
  console.log(`✓ Inquilino: ${tenant.nome}`);

  // Property
  const propertyExisting = await prisma.property.findFirst({
    where: { orgId: org.id, matricula: "MAT-DEMO-001" },
    select: { id: true },
  });
  const property =
    propertyExisting ??
    (await prisma.property.create({
      data: {
        orgId: org.id,
        kind: "salao",
        status: "locado",
        rua: "Rua Miguel Rachid",
        numero: "123",
        bairro: "Vila Paranaguá",
        cidade: "São Paulo",
        uf: "SP",
        cep: "03808-130",
        matricula: "MAT-DEMO-001",
        cartorio: "11º Ofício de Registro de Imóveis",
        inscricaoIptu: "123.456.0001-2",
        area: 250,
        valorAluguelSugerido: 2195.79,
        tipoDimob: "urbano",
        atributos: { quartos: 0, vagas: 4, mobiliado: false },
      },
    }));
  console.log(`✓ Imóvel: ${property.id}`);

  // PropertyOwnership 50/50
  for (const [o, pct, tipo] of [
    [owner1, 50, "proprietario_principal"],
    [owner2, 50, "proprietario"],
  ] as const) {
    await prisma.propertyOwnership.upsert({
      where: { propertyId_ownerId: { propertyId: property.id, ownerId: o.id } },
      update: { percentual: pct, tipo },
      create: {
        orgId: org.id,
        propertyId: property.id,
        ownerId: o.id,
        percentual: pct,
        tipo,
      },
    });
  }
  console.log(`✓ Ownership 50/50 vinculado`);

  // LeaseContract
  const leaseExisting = await prisma.leaseContract.findFirst({
    where: { orgId: org.id, propertyId: property.id, status: "ativo" },
    select: { id: true },
  });
  const lease =
    leaseExisting ??
    (await prisma.leaseContract.create({
      data: {
        orgId: org.id,
        propertyId: property.id,
        status: "ativo",
        finalidade: "comercial",
        valorAluguel: 2195.79,
        valorEncargos: 400,
        diaVencimento: 10,
        indiceReajuste: "IGPM",
        vigenciaInicio: new Date("2023-09-08"),
        vigenciaFim: new Date("2026-09-08"),
        taxaAdminPercent: 9,
        regimeCobranca: "mes_a_vencer",
        regimeIr: "retem_imobiliaria",
        repasseTipo: "dias_uteis_apos",
        repasseDia: 3,
        repasseGarantido: "alguns_meses",
        repasseGarantidoMeses: 12,
        repasseGarantidoEscopo: "aluguel",
        emitirNfse: true,
      },
    }));
  console.log(`✓ Contrato: ${lease.id}`);

  // LeaseTenant
  await prisma.leaseTenant.upsert({
    where: { leaseContractId_tenantId: { leaseContractId: lease.id, tenantId: tenant.id } },
    update: {},
    create: {
      orgId: org.id,
      leaseContractId: lease.id,
      tenantId: tenant.id,
      tipo: "titular",
    },
  });
  console.log(`✓ Locatário vinculado ao contrato`);

  // Checklist Entrada (com template se existir)
  const template = await prisma.checklistTemplate.findUnique({
    where: { orgId_nome: { orgId: org.id, nome: "Entrada" } },
  });
  const checklistExisting = await prisma.checklist.findFirst({
    where: { orgId: org.id, leaseContractId: lease.id, nome: "Entrada" },
  });
  if (!checklistExisting) {
    const itens = template
      ? template.itensJson
      : [
          { titulo: "Documentos aprovados", status: "concluido" },
          { titulo: "Garantia formalizada", status: "concluido" },
          { titulo: "Vistoria de entrada", status: "pendente" },
          { titulo: "Chaves entregues", status: "pendente" },
        ];
    await prisma.checklist.create({
      data: {
        orgId: org.id,
        leaseContractId: lease.id,
        templateId: template?.id ?? null,
        nome: "Entrada",
        status: "aguardando_aprovacao",
        itensJson: itens as object,
      },
    });
    console.log(`✓ Checklist Entrada criado`);
  }

  // RentCharges: 3 cobranças (paga, pendente, atrasada)
  const competencias = ["2026-05", "2026-06", "2026-04"];
  const statuses = ["paga", "pendente", "atrasada"] as const;
  for (let i = 0; i < competencias.length; i++) {
    const comp = competencias[i];
    const status = statuses[i];
    const [y, m] = comp.split("-").map(Number);
    const dueDate = new Date(y, m - 1, 10, 12);
    await prisma.rentCharge.upsert({
      where: {
        leaseContractId_competencia_kind: {
          leaseContractId: lease.id,
          competencia: comp,
          kind: "aluguel",
        },
      },
      update: { status },
      create: {
        orgId: org.id,
        leaseContractId: lease.id,
        kind: "aluguel",
        competencia: comp,
        dueDate,
        valorBase: 2195.79,
        encargos: 400,
        status,
        paidAt: status === "paga" ? new Date(y, m - 1, 12) : null,
      },
    });
  }
  console.log(`✓ 3 RentCharges criadas`);

  // Expenses
  const expenseExisting = await prisma.expense.findMany({
    where: { orgId: org.id, leaseContractId: lease.id },
    select: { id: true, type: true },
  });
  if (!expenseExisting.some((e) => e.type === "iptu")) {
    await prisma.expense.create({
      data: {
        orgId: org.id,
        leaseContractId: lease.id,
        propertyId: property.id,
        type: "iptu",
        descricao: "IPTU 2026 - Parcela 5/10",
        valor: 57.58,
        dueDate: new Date(2026, 4, 15, 12),
        parcelaN: 5,
        parcelaTotal: 10,
        debitoDe: "locatario",
        creditoPara: "proprietario",
        status: "pendente",
      },
    });
  }
  if (!expenseExisting.some((e) => e.type === "condominio")) {
    await prisma.expense.create({
      data: {
        orgId: org.id,
        leaseContractId: lease.id,
        type: "condominio",
        descricao: "Condomínio Maio/2026",
        valor: 480,
        dueDate: new Date(2026, 4, 5, 12),
        parcelaN: 1,
        parcelaTotal: 1,
        debitoDe: "locatario",
        creditoPara: "proprietario",
        status: "pago",
        paidAt: new Date(2026, 4, 4),
      },
    });
  }
  console.log(`✓ 2 despesas criadas`);

  // InsurancePolicy (incêndio, vencendo em 45d pra aparecer no card)
  const insExisting = await prisma.insurancePolicy.findFirst({
    where: { orgId: org.id, leaseContractId: lease.id, tipo: "seguro_incendio" },
  });
  if (!insExisting) {
    await prisma.insurancePolicy.create({
      data: {
        orgId: org.id,
        leaseContractId: lease.id,
        propertyId: property.id,
        tipo: "seguro_incendio",
        seguradora: "Tokio Marine",
        apoliceNumero: "APL-2025-987654",
        vigenciaInicio: new Date(2025, 6, 1),
        vigenciaFim: new Date(Date.now() + 45 * 24 * 3600_000),
        premioMensal: 18.5,
        responsavelPagamento: "locatario",
        status: "ativa",
      },
    });
    console.log(`✓ Apólice de seguro incêndio criada (vence em 45d)`);
  }

  // NewtonRequest demo
  const newtonExisting = await prisma.newtonRequest.findFirst({
    where: { orgId: org.id, ask: { contains: "Pedir comprovante" } },
  });
  if (!newtonExisting) {
    // Pra criar NewtonRequest precisa de um Deal — vou pular se não houver Deal de locação.
    const dealLoc = await prisma.deal.findFirst({
      where: { kind: "locacao", pipeline: { orgId: org.id } },
      select: { id: true, pipeline: { select: { orgId: true } } },
    });
    if (dealLoc) {
      const userOwner = await prisma.orgMembership.findFirst({
        where: { orgId: org.id, role: "owner" },
        select: { userId: true },
      });
      if (userOwner) {
        await prisma.newtonRequest.create({
          data: {
            orgId: org.id,
            dealId: dealLoc.id,
            createdBy: userOwner.userId,
            ask: "Pedir comprovante de pagamento do aluguel maio/2026 — Angelo Rodrigues",
            targetType: "contact",
            targetRef: "5511977776666",
            targetLabel: "Angelo (inquilino)",
            status: "open",
            priority: "normal",
            eventsJson: [
              {
                at: new Date().toISOString(),
                actor: "sistema",
                type: "dunning_stage_triggered",
                note: "stage=atraso_d_plus_1",
              },
            ],
          },
        });
        console.log(`✓ NewtonRequest demo criado`);
      }
    } else {
      console.log(`(skip NewtonRequest: nenhum Deal kind=locacao ainda)`);
    }
  }

  console.log("\n✅ Seed demo concluído!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
