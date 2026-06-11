import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import {
  LOCACAO_SCHEMA_TYPE,
  LOCACAO_COMERCIAL_SCHEMA_TYPE,
} from "@/lib/forms/validation-locacao";

export const dynamic = "force-dynamic";

// POST /api/locacao/forms — o OPERADOR cria um formulário público de locação.
// Coleta finalidade (residencial|comercial) + config fiscal/comissão (operador-
// only) e cria SalesForm(schemaType locação) + Deal(kind=locacao) no 1º stage do
// pipeline de locação. O cliente preenche partes/imóvel/aluguel/garantia em
// /f/[token]; o finalize gera o contrato (ver [token]/route.ts).
const angariadorSchema = z.object({
  party_id: z.string().optional(),
  nome: z.string().min(2),
  forma_comissao: z.enum(["percentual", "valor_fixo"]).default("percentual"),
  percentual: z.number().min(0).max(100).optional(),
  valor_fixo: z.number().min(0).optional(),
  meses_comissao: z.number().int().min(0).optional(),
});

const bodySchema = z.object({
  finalidade: z.enum(["residencial", "comercial"]).default("residencial"),
  title: z.string().optional(),
  fiscal: z
    .object({
      taxa_admin_percent: z.number().min(0).max(100).default(10),
      regime_ir: z
        .enum(["nao_retem", "retem_sem_controle", "retem_imobiliaria", "retem_inquilino"])
        .default("nao_retem"),
      regime_cobranca: z.enum(["mes_vencido", "mes_a_vencer"]).default("mes_a_vencer"),
      isencao_multa_meses: z.number().int().min(0).default(0),
      emitir_nfse: z.boolean().default(false),
      repasse_garantido: z.enum(["nao", "alguns_meses", "todo_contrato"]).default("nao"),
      repasse_garantido_meses: z.number().int().min(0).optional(),
    })
    .optional(),
  comissao: z
    .object({
      taxa_locacao_percent: z.number().min(0).max(100).default(0),
      angariadores: z.array(angariadorSchema).default([]),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_CREATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const schemaType =
    d.finalidade === "comercial" ? LOCACAO_COMERCIAL_SCHEMA_TYPE : LOCACAO_SCHEMA_TYPE;

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: ctx.orgId, kind: "locacao" },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline || pipeline.stages.length === 0) {
    return NextResponse.json(
      { error: "Pipeline locação não inicializada. Rode seed-pipeline-locacao.ts --apply." },
      { status: 412 }
    );
  }
  // Deal nasce no stage "Formulário" (link público sendo preenchido). "Em
  // Aprovação" (1º stage) fica como coluna manual pré-formulário. Fallback p/
  // o 1º stage se "Formulário" não existir.
  const firstStage =
    pipeline.stages.find((s) => s.name === "Formulário") ?? pipeline.stages[0];

  const result = await prisma.$transaction(async (tx) => {
    const form = await tx.salesForm.create({
      data: {
        orgId: ctx.orgId,
        title: d.title || null,
        schemaType,
        status: "rascunho",
        // Config fiscal/comissão (operador-only) já pré-gravada — o auto-save do
        // cliente faz deep-merge e não toca essas chaves.
        dataJson: {
          finalidade: d.finalidade,
          ...(d.fiscal ? { fiscal: d.fiscal } : {}),
          ...(d.comissao ? { comissao: d.comissao } : {}),
        } as object,
      },
    });

    const dealsInStage = await tx.deal.count({ where: { stageId: firstStage.id } });
    const deal = await tx.deal.create({
      data: {
        pipelineId: pipeline.id,
        stageId: firstStage.id,
        userId: ctx.userId,
        formId: form.id,
        kind: "locacao",
        title: d.title || `Locação - ${form.token.slice(0, 8)}`,
        position: dealsInStage,
      },
    });

    return { form, deal };
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "FORM_CREATE",
      result: "SUCCESS",
      resource: result.form.id,
      resourceType: "SalesForm",
      metadata: {
        kind: "locacao",
        schemaType,
        finalidade: d.finalidade,
        token: result.form.token,
        dealId: result.deal.id,
      },
    }
  );

  return NextResponse.json(
    {
      id: result.form.id,
      token: result.form.token,
      url: `/f/${result.form.token}`,
      dealId: result.deal.id,
    },
    { status: 201 }
  );
}
