import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { matchDealGroup } from "@/lib/newton/group-match";
import { resolveManagerForCreate } from "@/lib/deals/manager";
import { guardDealCreate } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { MODULE } from "@/lib/modules/catalog";

export const runtime = "nodejs";

// Body opcional — a conversão v1 não exigia payload nenhum. Só o gerente
// responsável (feature Gerente) entra aqui, sempre opcional.
const bodySchema = z.object({
  managerUserId: z.string().min(1).optional(),
});

/**
 * POST /api/leads/:leadId/convert-to-deal
 *
 * Converte Lead em SalesForm + Deal no primeiro stage do pipeline default.
 * Marca Lead com status=converted + convertedDealId.
 *
 * v1: cria Form/Deal vazio com title + dataJson preenchido com `metadata`
 * da lead. Negociadora completa o resto pela UI.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { leadId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  // Converter lead CRIA um negócio — mesmo gate das demais rotas de criação
  // (2026-09-02). Ver guardDealCreate.
  const deniedCreate = await guardDealCreate({
    userId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    via: apiAuth.ident.via,
    permission: PERMISSION.DEAL_CREATE,
  });
  if (deniedCreate) return deniedCreate;

  const parsedBody = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: parsedBody.error.message },
      { status: 400 }
    );
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.leadId },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  if (lead.orgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (lead.status === "converted" && lead.convertedDealId) {
    return NextResponse.json(
      { error: "Lead já convertida", dealId: lead.convertedDealId },
      { status: 409 }
    );
  }

  // SEMPRE por kind — é o footgun que o comentário do `getPipelineByKind`
  // documenta, e aqui ele era real: as 5 orgs de produção que têm pipeline têm
  // venda E locação, então `findFirst({ orgId })` era ambíguo em TODAS. A
  // conversão podia cair no pipeline de LOCAÇÃO logo depois de cobrar
  // DEAL_CREATE ("criar negócio de venda") acima. Nenhuma lead foi convertida
  // em produção até aqui, então não há negócio no lugar errado a corrigir.
  const pipeline = await getPipelineByKind(apiAuth.org.id, MODULE.VENDAS, {
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });
  if (!pipeline || pipeline.stages.length === 0) {
    return NextResponse.json(
      { error: "Org sem pipeline default" },
      { status: 400 }
    );
  }

  // Gerente responsável resolvido FORA da transação.
  const manager = await resolveManagerForCreate(
    apiAuth.org.id,
    parsedBody.data.managerUserId
  );
  if (!manager.ok) {
    return NextResponse.json(
      { error: manager.error, message: manager.message },
      { status: manager.status }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const form = await tx.salesForm.create({
      data: {
        orgId: apiAuth.org.id,
        title: lead.title,
        schemaType: "compra_venda_v1",
        dataJson: (lead.metadata ?? {}) as Prisma.InputJsonValue,
        token: cryptoRandomToken(),
      },
    });
    const deal = await tx.deal.create({
      data: {
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0].id,
        userId: apiAuth.actor.effectiveUserId,
        formId: form.id,
        managerUserId: manager.managerUserId,
        sourceChannel: DEAL_SOURCE_CHANNEL.LEAD,
        title: lead.title,
      },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: "converted",
        convertedDealId: deal.id,
        lastActivityAt: new Date(),
      },
    });
    return { form, deal };
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "LEAD_CONVERT_TO_DEAL",
      result: "SUCCESS",
      resource: lead.id,
      resourceType: "Lead",
      metadata: mergeAuditMetadata(
        { dealId: result.deal.id, formId: result.form.id },
        apiAuth.actor
      ),
    }
  );

  // Deal recém-convertido herda os telefones das partes do lead → tenta
  // auto-vincular o grupo de WhatsApp do negócio. Best-effort.
  waitUntil(matchDealGroup(result.deal.id).catch(() => {}));

  return NextResponse.json({
    leadId: lead.id,
    dealId: result.deal.id,
    formId: result.form.id,
    formToken: result.form.token,
    formUrl: `/forms/${result.form.token}`,
    dealUrl: `/deals/${result.deal.id}`,
  });
}

function cryptoRandomToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
