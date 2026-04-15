import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const patchSchema = z.object({
  htmlContent: z.string().min(1).max(5_000_000),
});

/**
 * PATCH /api/contracts/:id
 *
 * Auto-save endpoint for the contract editor. Persists the current HTML
 * content in-place, WITHOUT creating a new ContractVersion row. To create a
 * new version use POST /api/contracts/:id/version instead.
 *
 * Blocked when the contract is approved (status === 'aprovado').
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      deal: { include: { form: { select: { orgId: true } } } },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    contract.deal?.form &&
    contract.deal.form.orgId !== org.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (contract.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado nao pode ser editado" },
      { status: 403 }
    );
  }

  await prisma.contract.update({
    where: { id: params.id },
    data: {
      htmlContent: parsed.data.htmlContent,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
