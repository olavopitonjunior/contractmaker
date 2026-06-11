import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * DELETE /api/deals/:dealId/diligenciados/:id
 *
 * Soft-aware delete: if the person has any CertidaoJob linked by
 * diligentedPersonId (stable anchor; positional targetIndex fallback for legacy
 * rows), refuse the delete to preserve the audit trail. Otherwise hard-delete.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { dealId: string; id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const person = await prisma.diligentedPerson.findUnique({
    where: { id: params.id },
    include: { deal: { include: { form: { select: { orgId: true } } } } },
  });
  if (!person || person.dealId !== params.dealId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (person.deal.form && person.deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Guard: bloqueia a remoção se a pessoa já tem certidões — preserva o histórico
  // (os jobs ficariam órfãos). Âncora PRIMÁRIA = diligentedPersonId (estável, não
  // desliza com remoções). Fallback posicional cobre jobs legados sem o FK
  // (anteriores ao backfill), via o índice ATUAL da pessoa.
  let hasJobs = await prisma.certidaoJob.findFirst({
    where: { dealId: params.dealId, diligentedPersonId: params.id },
    select: { id: true },
  });
  if (!hasJobs) {
    const all = await prisma.diligentedPerson.findMany({
      where: { dealId: params.dealId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const idx = all.findIndex((p) => p.id === params.id);
    if (idx >= 0) {
      hasJobs = await prisma.certidaoJob.findFirst({
        where: {
          dealId: params.dealId,
          targetKind: "diligenciado",
          targetIndex: idx,
          diligentedPersonId: null, // só legados sem âncora
        },
        select: { id: true },
      });
    }
  }
  if (hasJobs) {
    return NextResponse.json(
      {
        error:
          "Esta pessoa já tem certidões extraídas. Não pode ser removida — os jobs ficariam órfãos.",
      },
      { status: 409 }
    );
  }

  await prisma.diligentedPerson.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
