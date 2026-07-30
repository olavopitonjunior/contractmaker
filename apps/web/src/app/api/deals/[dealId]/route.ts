import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
  type ApiAuthSuccess,
} from "@/lib/api/require-auth";
import { getEffectivePermissions, canAccessDeal } from "@/lib/security/rbac/check";
import { etagFor } from "@/lib/api/etag";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { requireApproval, approvalResponse } from "@/lib/api/intents";
import { notifyDealEvent, stageChangeDedupeKey } from "@/lib/notifications/deal-events";
import { waitUntil } from "@vercel/functions";

export const runtime = "nodejs";

/**
 * Escopo por usuário (feature Gerente): visão restrita só alcança deals onde
 * é gerente atribuído ou criador (404 pra não vazar existência). Bearer/Newton
 * é serviço da ORG — passa direto. Null = segue o fluxo.
 */
async function dealScopeGuard(
  apiAuth: ApiAuthSuccess,
  deal: { userId: string; managerUserId: string | null }
): Promise<NextResponse | null> {
  if (apiAuth.ident.via === "bearer") return null;
  const eff = await getEffectivePermissions(
    apiAuth.actor.effectiveUserId,
    apiAuth.org.id
  );
  if (
    eff &&
    canAccessDeal({
      effective: eff,
      ownerUserId: deal.userId,
      managerUserId: deal.managerUserId,
    })
  ) {
    return null;
  }
  return NextResponse.json({ error: "Deal not found" }, { status: 404 });
}

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
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
      stage: { select: { id: true, name: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await dealScopeGuard(auth, deal);
  if (denied) return denied;

  const etag = etagFor({ updatedAt: deal.updatedAt });
  return NextResponse.json(
    { deal },
    { headers: { ETag: etag } }
  );
}

const patchSchema = z.object({
  stageId: z.string().optional(),
  title: z.string().optional(),
});

/**
 * PATCH /api/deals/:dealId
 *
 * Newton-friendly Bearer twin de `/api/pipeline/deals/:dealId` PATCH.
 * Move stage e/ou renomeia. Reversível, sem HITL — Newton consegue desfazer
 * mandando outro PATCH com stageId anterior.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!parsed.data.stageId && !parsed.data.title) {
    return NextResponse.json(
      { error: "Forneça pelo menos stageId ou title" },
      { status: 400 }
    );
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { orgId: true } },
      pipeline: { select: { orgId: true } },
      stage: { select: { id: true, name: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await dealScopeGuard(apiAuth, deal);
  if (denied) return denied;

  // Se for trocar stage, validar que a stage pertence ao mesmo pipeline.
  if (parsed.data.stageId && parsed.data.stageId !== deal.stageId) {
    const targetStage = await prisma.pipelineStage.findFirst({
      where: { id: parsed.data.stageId, pipelineId: deal.pipelineId },
      select: { id: true, name: true },
    });
    if (!targetStage) {
      return NextResponse.json(
        { error: "stageId inválido para o pipeline deste deal" },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.deal.update({
    where: { id: deal.id },
    data: {
      ...parsed.data,
      // Aging por stage: qualquer mudança de stage carimba a entrada (mesmo
      // invariante do PATCH session em /api/pipeline/deals/[dealId]).
      ...(parsed.data.stageId ? { stageEnteredAt: new Date() } : {}),
    },
    include: { stage: { select: { id: true, name: true } } },
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "DEAL_UPDATE",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: mergeAuditMetadata(
        {
          fromStage: deal.stage.name,
          toStage: updated.stage.name,
          changedTitle: parsed.data.title !== undefined,
        },
        apiAuth.actor
      ),
    }
  );

  // Notificação do processo — MESMO hook do PATCH de sessão em
  // /api/pipeline/deals/[dealId]:133. Antes só a rota de sessão notificava, o
  // que fazia o corretor ser avisado quando um humano arrastava o card e NÃO
  // quando o Newton movia o mesmo negócio via `move_deal_stage`. A mudança de
  // status importa por si; quem a fez é irrelevante pro corretor.
  //
  // Mesmo dedupeKey (stage, dia BRT) das duas rotas, então mover pela API e
  // arrastar o card no mesmo dia pro mesmo stage não notifica em dobro.
  if (parsed.data.stageId && parsed.data.stageId !== deal.stageId) {
    waitUntil(
      notifyDealEvent({
        dealId: updated.id,
        orgId: apiAuth.org.id,
        event: "stage_change",
        dedupeKey: stageChangeDedupeKey(updated.stageId),
        context: { stageName: updated.stage.name },
      })
    );
  }

  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    stageId: updated.stageId,
    stage: updated.stage,
    updatedAt: updated.updatedAt,
  });
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
      userId: true,
      managerUserId: true,
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

  const denied = await dealScopeGuard(auth, deal);
  if (denied) return denied;

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
      data: { stageId: archived.id, stageEnteredAt: new Date() },
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
