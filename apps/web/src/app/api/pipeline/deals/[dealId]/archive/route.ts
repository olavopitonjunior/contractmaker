import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

const Body = z.object({
  // true = arquiva, false = desarquiva. Default true (rota chamada pra arquivar).
  archived: z.boolean().optional().default(true),
});

/**
 * POST /api/pipeline/deals/:dealId/archive
 *
 * Arquiva (ou desarquiva) um negócio: tira do kanban sem apagar nada. Não muda
 * stage nem documentos — só seta `Deal.archivedAt`. Reversível pelo mesmo
 * endpoint com `{ archived: false }`. Auth + cross-org guard via
 * `deal.pipeline.orgId` + audit (DEAL_ARCHIVED / DEAL_UNARCHIVED).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  // `requireAuth` (e não `auth()` cru): sob impersonation de tenant,
  // `ctx.userId` é o DONO do tenant — é ele que tem membership/RBAC na org
  // impersonada. Com o id cru do super_admin o RBAC negava tudo (404/403).
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = Body.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      archivedAt: true,
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
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

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: wantArchived ? "DEAL_ARCHIVED" : "DEAL_UNARCHIVED",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: { wasArchived: deal.archivedAt !== null },
  });

  return NextResponse.json({
    dealId: deal.id,
    archived: wantArchived,
    archivedAt: nextArchivedAt,
  });
}
