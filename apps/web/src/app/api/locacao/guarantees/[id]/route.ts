import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { guaranteeUpdateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.GUARANTEE_MANAGE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.guarantee.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Garantia não encontrada" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, guaranteeUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const guarantee = await prisma.guarantee.update({
    where: { id },
    data: parsed.data,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "GUARANTEE_UPDATE",
      result: "SUCCESS",
      resource: id,
      resourceType: "Guarantee",
      metadata: { de: existing.status, para: guarantee.status },
    }
  );

  return NextResponse.json({ guarantee });
}
