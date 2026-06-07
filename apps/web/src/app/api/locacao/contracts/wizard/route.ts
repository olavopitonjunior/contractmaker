import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { LOCACAO_SCHEMA_TYPE } from "@/lib/forms/validation-locacao";
import { nextReadjustmentDate } from "@/lib/locacao/readjustment-calculator";

export const dynamic = "force-dynamic";

const wizardSchema = z.object({
  propertyId: z.string().min(1),
  tenantIds: z.array(z.string().min(1)).min(1),
  garantia: z.object({
    tipo: z.enum([
      "caucionante",
      "caucao",
      "cessao_fiduciaria",
      "fiador",
      "seguro_fianca",
      "titulo_capitalizacao",
      "sem_garantia",
    ]),
    caucaoSubtipo: z.enum(["valor", "veiculo", "carta_fianca", "imovel", "outros"]).optional(),
    provider: z.string().optional(),
  }),
  valorAluguel: z.number().positive(),
  valorEncargos: z.number().nonnegative().default(0),
  diaVencimento: z.number().int().min(1).max(31),
  indiceReajuste: z.enum(["IGPM", "IPCA", "IGP-DI", "outro"]),
  vigenciaMeses: z.number().int().min(1).max(120),
  regimeIr: z.enum(["nao_retem", "retem_sem_controle", "retem_imobiliaria", "retem_inquilino"]),
  regimeCobranca: z.enum(["mes_vencido", "mes_a_vencer"]),
  taxaAdminPercent: z.number().nonnegative(),
  emitirNfse: z.boolean().default(false),
  finalidade: z.enum([
    "residencial",
    "nao_residencial",
    "comercial",
    "industria",
    "temporada",
    "por_encomenda",
    "mista",
  ]),
});

/**
 * POST /api/locacao/contracts/wizard — cria Deal + SalesForm pré-populado +
 * LeaseContract rascunho (com Garantee opcional) no primeiro stage da Esteira.
 * Wizard 5 passos do Superlógica.
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_CREATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, wizardSchema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const [property, tenants, pipeline] = await Promise.all([
    prisma.property.findFirst({
      where: { id: d.propertyId, orgId: ctx.orgId },
      include: { ownerships: { include: { owner: { select: { nome: true } } } } },
    }),
    prisma.tenant.findMany({
      where: { id: { in: d.tenantIds }, orgId: ctx.orgId },
      select: { id: true, nome: true },
    }),
    prisma.pipeline.findFirst({
      where: { orgId: ctx.orgId, kind: "locacao" },
      include: { stages: { orderBy: { position: "asc" } } },
    }),
  ]);

  if (!property) return NextResponse.json({ error: "Imóvel não encontrado" }, { status: 422 });
  if (tenants.length !== d.tenantIds.length) {
    return NextResponse.json({ error: "Um ou mais locatários não pertencem à org" }, { status: 422 });
  }
  if (!pipeline || pipeline.stages.length === 0) {
    return NextResponse.json(
      { error: "Pipeline locação não inicializada. Rode seed-pipeline-locacao.ts --apply." },
      { status: 412 }
    );
  }
  const firstStage =
    pipeline.stages.find((s) => s.name === "Formulário") ?? pipeline.stages[0];

  const enderecoFmt = [property.rua, property.numero, property.bairro]
    .filter(Boolean)
    .join(", ");
  const titulo = `${enderecoFmt || "Imóvel"} — ${tenants.map((t) => t.nome).join(", ")}`;

  const vigenciaInicio = new Date();
  const vigenciaFim = new Date(vigenciaInicio);
  vigenciaFim.setMonth(vigenciaFim.getMonth() + d.vigenciaMeses);
  const dataProximoReajuste = nextReadjustmentDate(vigenciaInicio);

  const result = await prisma.$transaction(async (tx) => {
    const form = await tx.salesForm.create({
      data: {
        orgId: ctx.orgId,
        title: titulo,
        schemaType: LOCACAO_SCHEMA_TYPE,
        status: "vinculado",
        dataJson: {
          locador: property.ownerships.map((o) => ({
            tipo_pessoa: "fisica",
            nome: o.owner.nome,
          })),
          locatario: tenants.map((t, idx) => ({
            tipo_pessoa: "fisica",
            nome: t.nome,
            tipo: idx === 0 ? "titular" : "solidario",
          })),
          imovel: {
            rua: property.rua,
            numero: property.numero,
            bairro: property.bairro,
            cidade: property.cidade,
            uf: property.uf,
            cep: property.cep,
            kind: property.kind,
            referencia_property_id: property.id,
          },
          aluguel: {
            valor: d.valorAluguel,
            encargos: d.valorEncargos,
            dia_vencimento: d.diaVencimento,
            indice_reajuste: d.indiceReajuste,
            vigencia_meses: d.vigenciaMeses,
            regime_ir: d.regimeIr,
            regime_cobranca: d.regimeCobranca,
            taxa_adm_percent: d.taxaAdminPercent,
            emitir_nfse: d.emitirNfse,
            finalidade: d.finalidade,
          },
          garantia: d.garantia,
        } as object,
      },
    });

    const deal = await tx.deal.create({
      data: {
        formId: form.id,
        stageId: firstStage.id,
        pipelineId: pipeline.id,
        userId: ctx.userId,
        kind: "locacao",
        title: titulo,
        value: d.valorAluguel,
      },
    });

    // Cria LeaseContract rascunho com os campos fiscais já preenchidos.
    const lease = await tx.leaseContract.create({
      data: {
        orgId: ctx.orgId,
        propertyId: d.propertyId,
        dealId: deal.id,
        status: "rascunho",
        finalidade: d.finalidade,
        valorAluguel: d.valorAluguel,
        valorEncargos: d.valorEncargos,
        diaVencimento: d.diaVencimento,
        indiceReajuste: d.indiceReajuste,
        vigenciaInicio,
        vigenciaFim,
        dataProximoReajuste,
        taxaAdminPercent: d.taxaAdminPercent,
        regimeCobranca: d.regimeCobranca,
        regimeIr: d.regimeIr,
        emitirNfse: d.emitirNfse,
      },
    });

    // Vincula tenants (LeaseTenant N:N).
    for (let i = 0; i < tenants.length; i++) {
      await tx.leaseTenant.create({
        data: {
          orgId: ctx.orgId,
          leaseContractId: lease.id,
          tenantId: tenants[i].id,
          tipo: i === 0 ? "titular" : "solidario",
        },
      });
    }

    // Cria Guarantee se aplicável.
    if (d.garantia.tipo !== "sem_garantia") {
      await tx.guarantee.create({
        data: {
          orgId: ctx.orgId,
          leaseContractId: lease.id,
          tipo: d.garantia.tipo,
          caucaoSubtipo: d.garantia.tipo === "caucao" ? d.garantia.caucaoSubtipo ?? null : null,
          provider:
            d.garantia.tipo === "seguro_fianca" ? d.garantia.provider ?? null : null,
          status: "pendente",
        },
      });
    }

    return { form, deal, lease };
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "DEAL_CREATE",
      result: "SUCCESS",
      resource: result.deal.id,
      resourceType: "Deal",
      metadata: {
        kind: "locacao",
        via: "wizard",
        leaseContractId: result.lease.id,
        propertyId: d.propertyId,
        tenantCount: tenants.length,
        garantia: d.garantia.tipo,
        stageId: firstStage.id,
      },
    }
  );

  return NextResponse.json(
    {
      dealId: result.deal.id,
      leaseContractId: result.lease.id,
      stage: firstStage.name,
    },
    { status: 201 }
  );
}
