import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { etagFor } from "@/lib/api/etag";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { requireApproval, approvalResponse } from "@/lib/api/intents";

export const runtime = "nodejs";

/**
 * GET /api/deals/:dealId
 *
 * Retorna deal + dados do form vinculado. Inclui header `ETag` baseado em
 * `updatedAt` do deal — Newton usa para detecção de concorrência (PRD §6.6).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: {
        select: { orgId: true, dataJson: true, token: true, status: true },
      },
      stage: { select: { id: true, name: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.form && deal.form.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Cross-org guard adicional: deal sem form precisa pertencer a pipeline da org
  if (!deal.form) {
    const stageOk = await prisma.pipelineStage.findFirst({
      where: { id: deal.stageId, pipeline: { orgId: auth.org.id } },
      select: { id: true },
    });
    if (!stageOk) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const etag = etagFor({ updatedAt: deal.updatedAt });
  return NextResponse.json(
    { deal },
    { headers: { ETag: etag } }
  );
}

/**
 * DELETE /api/deals/:dealId
 *
 * Hard delete (cascade) ou soft delete (?soft=1, move para stage Arquivado).
 * Phase F.II-β do contractmaker.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      formId: true,
      title: true,
      form: { select: { orgId: true } },
      stage: { select: { pipeline: { select: { orgId: true } } } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const dealOrgId = deal.form?.orgId ?? deal.stage?.pipeline?.orgId;
  if (dealOrgId !== auth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const soft = searchParams.get("soft") === "1";

  if (soft) {
    const archived = await prisma.pipelineStage.findFirst({
      where: {
        pipeline: { orgId: auth.org.id },
        name: { contains: "rquiv", mode: "insensitive" },
      },
      select: { id: true },
    });
    if (!archived) {
      return NextResponse.json(
        {
          error:
            "Soft delete requires an 'Arquivado' stage. Create one or use hard delete (remove ?soft=1).",
        },
        { status: 400 }
      );
    }
    await prisma.deal.update({
      where: { id: params.dealId },
      data: { stageId: archived.id },
    });
    await audit(
      extractAuditContextFromRequest(
        req,
        auth.org.id,
        auth.actor.effectiveUserId
      ),
      {
        action: "DEAL_DELETE",
        result: "SUCCESS",
        resource: params.dealId,
        resourceType: "Deal",
        metadata: mergeAuditMetadata(
          { mode: "soft", title: deal.title },
          auth.actor
        ),
      }
    );
    return NextResponse.json({ ok: true, mode: "soft", dealId: params.dealId });
  }

  // Hard delete: dual-approval pra Bearer, direto pra session.
  const idempotencyKey = req.headers.get("x-idempotency-key");
  const result = await requireApproval<unknown>({
    ctx: {
      via: auth.ident.via,
      userId: auth.ident.userId,
      orgId: auth.org.id,
      actor: auth.actor,
    },
    action: "DEAL_DELETE_HARD",
    payload: { dealId: params.dealId },
    preview: {
      summary: `Excluir deal "${deal.title}" permanentemente (cascata: contratos, certidões, anexos)`,
      details: { dealId: params.dealId, title: deal.title },
    },
    req,
    idempotencyKey,
    run: async () => {
      await prisma.$transaction(async (tx) => {
        await tx.deal.delete({ where: { id: params.dealId } });
        if (deal.formId) {
          await tx.salesForm
            .delete({ where: { id: deal.formId } })
            .catch(() => {});
        }
      });
      return {
        status: 200,
        body: { ok: true, mode: "hard", dealId: params.dealId },
      };
    },
  });

  if (result.via === "executed") {
    await audit(
      extractAuditContextFromRequest(
        req,
        auth.org.id,
        auth.actor.effectiveUserId
      ),
      {
        action: "DEAL_DELETE",
        result: "SUCCESS",
        resource: params.dealId,
        resourceType: "Deal",
        metadata: mergeAuditMetadata(
          { mode: "hard", title: deal.title },
          auth.actor
        ),
      }
    );
  }
  return approvalResponse(result);
}
