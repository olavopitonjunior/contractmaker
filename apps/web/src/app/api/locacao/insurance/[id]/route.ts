import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { insurancePolicyUpdateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSURANCE_MANAGE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.insurancePolicy.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Apólice não encontrada" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, insurancePolicyUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const policy = await prisma.insurancePolicy.update({
    where: { id },
    data: parsed.data,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "INSURANCE_UPDATE",
      result: "SUCCESS",
      resource: id,
      resourceType: "InsurancePolicy",
      metadata: { de: existing.status, para: policy.status },
    }
  );

  return NextResponse.json({ policy });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSURANCE_MANAGE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.insurancePolicy.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Apólice não encontrada" }, { status: 404 });
  }
  if (existing.status !== "cotacao") {
    return NextResponse.json(
      { error: "Só cotações podem ser excluídas. Cancele a apólice via edição de status." },
      { status: 422 }
    );
  }

  await prisma.insurancePolicy.delete({ where: { id } });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "INSURANCE_DELETE",
      result: "SUCCESS",
      resource: id,
      resourceType: "InsurancePolicy",
      metadata: { status: existing.status },
    }
  );

  return NextResponse.json({ ok: true });
}
