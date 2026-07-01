import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

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
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const wantArchived = parsed.data.archived;
  const nextArchivedAt = wantArchived ? new Date() : null;

  // Idempotente: arquivar já-arquivado (ou vice-versa) não erra.
  await prisma.deal.update({
    where: { id: deal.id },
    data: { archivedAt: nextArchivedAt },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
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
