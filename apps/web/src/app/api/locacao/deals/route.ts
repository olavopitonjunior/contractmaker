import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { LOCACAO_SCHEMA_TYPE } from "@/lib/forms/validation-locacao";

export const dynamic = "force-dynamic";

const novoDealLocacaoSchema = z.object({
  propertyId: z.string().min(1),
  tenantId: z.string().min(1),
  valorAluguel: z.number().positive(),
  vigenciaMeses: z.number().int().min(1).max(60).default(30),
});

/**
 * POST /api/locacao/deals — cria um Deal de locação no primeiro stage da Esteira.
 *
 * Pipeline kind="locacao" precisa existir (seed-pipeline-locacao.ts). Cria:
 * 1. SalesForm vazio com schemaType="locacao_residencial_v1" pré-populado
 *    com property/tenant/aluguel.
 * 2. Deal kind="locacao" no primeiro stage do pipeline.
 *
 * Não cria LeaseContract ainda — a administração começa quando o deal chega
 * em "ADM" (stage terminal do Pipeline de Locação). Aqui é só o início.
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_CREATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, novoDealLocacaoSchema);
  if (!parsed.ok) return parsed.response;

  // Resolve property + tenant (cross-org guard).
  const [property, tenant, pipeline] = await Promise.all([
    prisma.property.findFirst({
      where: { id: parsed.data.propertyId, orgId: ctx.orgId },
      include: { ownerships: { include: { owner: { select: { nome: true } } } } },
    }),
    prisma.tenant.findFirst({
      where: { id: parsed.data.tenantId, orgId: ctx.orgId },
    }),
    prisma.pipeline.findFirst({
      where: { orgId: ctx.orgId, kind: "locacao" },
      include: { stages: { orderBy: { position: "asc" } } },
    }),
  ]);
  if (!property) return NextResponse.json({ error: "Imóvel não encontrado" }, { status: 422 });
  if (!tenant) return NextResponse.json({ error: "Inquilino não encontrado" }, { status: 422 });
  if (!pipeline || pipeline.stages.length === 0) {
    return NextResponse.json(
      {
        error:
          "Pipeline locação não inicializada. Rode seed-pipeline-locacao.ts --apply primeiro.",
      },
      { status: 412 }
    );
  }
  // Inquilino já identificado → deal nasce em "Em Aprovação" (análise de
  // crédito da ficha). Fallback "Formulário" pra pipelines antigos.
  const firstStage =
    pipeline.stages.find((s) => s.name === "Em Aprovação") ??
    pipeline.stages.find((s) => s.name === "Formulário") ??
    pipeline.stages[0];

  const enderecoFmt = [property.rua, property.numero, property.bairro]
    .filter(Boolean)
    .join(", ");
  const ownerNames = property.ownerships
    .map((o) => o.owner.nome)
    .join(", ");

  const titulo = `${enderecoFmt || "Imóvel"} — ${tenant.nome}`;

  const result = await prisma.$transaction(async (tx) => {
    const form = await tx.salesForm.create({
      data: {
        orgId: ctx.orgId,
        title: titulo,
        schemaType: LOCACAO_SCHEMA_TYPE,
        status: "vinculado",
        dataJson: {
          // Chaves PLURAIS — shape canônico do dadosLocacaoSchema. As versões
          // singulares quebravam aba Dados/credit-analysis/derive (review 06/10).
          locadores: property.ownerships.map((o) => ({
            tipo_pessoa: "fisica",
            nome: o.owner.nome,
          })),
          locatarios: [
            { tipo_pessoa: "fisica", nome: tenant.nome, cpf: tenant.cpfCnpj ?? "" },
          ],
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
            valor: parsed.data.valorAluguel,
            vigencia_meses: parsed.data.vigenciaMeses,
          },
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
        sourceChannel: DEAL_SOURCE_CHANNEL.MANUAL,
        title: titulo,
        value: parsed.data.valorAluguel,
      },
    });
    return { form, deal };
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
        propertyId: property.id,
        tenantId: tenant.id,
        owners: ownerNames,
        stageId: firstStage.id,
      },
    }
  );

  return NextResponse.json(
    { dealId: result.deal.id, formId: result.form.id, stage: firstStage.name },
    { status: 201 }
  );
}
