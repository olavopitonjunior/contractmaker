import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { matchDealGroup } from "@/lib/newton/group-match";

export const runtime = "nodejs";

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

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: apiAuth.org.id },
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });
  if (!pipeline || pipeline.stages.length === 0) {
    return NextResponse.json(
      { error: "Org sem pipeline default" },
      { status: 400 }
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
