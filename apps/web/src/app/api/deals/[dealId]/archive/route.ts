import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

const Body = z.object({
  // true = arquiva, false = desarquiva. Default true (rota chamada pra arquivar).
  archived: z.boolean().optional().default(true),
});

/**
 * POST /api/deals/:dealId/archive
 *
 * Bearer twin de `/api/pipeline/deals/:dealId/archive`. Arquiva (ou desarquiva)
 * um negócio: tira do kanban sem apagar nada — só `Deal.archivedAt`.
 * Idempotente e reversível com `{ archived: false }`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const parsed = Body.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      archivedAt: true,
      pipeline: { select: { orgId: true } },
      form: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    via: apiAuth.ident.via,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  const wantArchived = parsed.data.archived;
  const nextArchivedAt = wantArchived ? new Date() : null;

  // Idempotente: arquivar já-arquivado (ou vice-versa) não erra.
  await prisma.deal.update({
    where: { id: deal.id },
    data: { archivedAt: nextArchivedAt },
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: wantArchived ? "DEAL_ARCHIVED" : "DEAL_UNARCHIVED",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: mergeAuditMetadata(
        { wasArchived: deal.archivedAt !== null },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json({
    dealId: deal.id,
    archived: wantArchived,
    archivedAt: nextArchivedAt,
  });
}
