import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * DELETE /api/deals/:dealId/diligenciados/:id
 *
 * Soft-aware delete: if the person has any CertidaoJob with targetKind
 * "diligenciado" and matching targetIndex, refuse the delete to preserve
 * the audit trail. Otherwise hard-delete the row.
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

  // Position-based check: diligenciados use the order they were created as
  // targetIndex (planner uses forEach index). Count persons before this one
  // to find the index.
  const all = await prisma.diligentedPerson.findMany({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const idx = all.findIndex((p) => p.id === params.id);

  if (idx >= 0) {
    const hasJobs = await prisma.certidaoJob.findFirst({
      where: {
        dealId: params.dealId,
        targetKind: "diligenciado",
        targetIndex: idx,
      },
      select: { id: true },
    });
    if (hasJobs) {
      return NextResponse.json(
        {
          error:
            "Esta pessoa já tem certidões extraídas. Não pode ser removida — os jobs ficariam órfãos.",
        },
        { status: 409 }
      );
    }
  }

  await prisma.diligentedPerson.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
