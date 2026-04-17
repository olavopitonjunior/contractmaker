import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * GET /api/deals/:dealId
 *
 * Returns the deal + related form data. Consumed by EditPartyDialog (Phase A)
 * to pre-fill party snapshot.
 */
export async function GET(
  _req: NextRequest,
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

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { orgId: true, dataJson: true, token: true, status: true } },
      stage: { select: { id: true, name: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ deal });
}

/**
 * DELETE /api/deals/:dealId
 *
 * Phase F.II-β — cascade delete completo:
 *   Deal → DealAttachment (via onDelete: Cascade no schema)
 *        → CertidaoJob (via onDelete: Cascade)
 *        → CertidoesShareLink (via onDelete: Cascade)
 *        → Contract (via onDelete: Cascade)
 *
 * O SalesForm vinculado (formId) NÃO é deletado automaticamente — é
 * deletado explicitamente aqui para limpeza completa em testes. Em
 * produção futura, considerar soft-delete (query param ?soft=1).
 */
export async function DELETE(
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

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      formId: true,
      form: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const soft = searchParams.get("soft") === "1";

  if (soft) {
    // Soft delete: move para stage "Arquivado" se existir, senão erro
    const archived = await prisma.pipelineStage.findFirst({
      where: { name: { contains: "rquiv", mode: "insensitive" } },
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
    return NextResponse.json({ ok: true, mode: "soft", dealId: params.dealId });
  }

  // Hard delete. Deal cascade remove attachments + certidão jobs + share links
  // + contratos. Form (SalesForm) precisa ser deletado em segundo lugar pois
  // o Deal tem FK para ele (não cascade — formId opcional).
  await prisma.$transaction(async (tx) => {
    await tx.deal.delete({ where: { id: params.dealId } });
    if (deal.formId) {
      await tx.salesForm.delete({ where: { id: deal.formId } }).catch(() => {
        // Form pode estar em uso por outro deal (unlikely pelo @unique, mas defensivo)
      });
    }
  });

  return NextResponse.json({ ok: true, mode: "hard", dealId: params.dealId });
}
