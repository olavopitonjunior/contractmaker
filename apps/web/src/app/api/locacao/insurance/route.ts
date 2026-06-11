import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { insurancePolicyCreateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSURANCE_VIEW);
  if (isRouteError(ctx)) return ctx;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const tipo = url.searchParams.get("tipo");
  const expiringInDays = url.searchParams.get("expiringInDays");

  let expiringFilter = {};
  if (expiringInDays && Number(expiringInDays) > 0) {
    const limit = new Date();
    limit.setDate(limit.getDate() + Number(expiringInDays));
    expiringFilter = { vigenciaFim: { lte: limit, gte: new Date() } };
  }

  const policies = await prisma.insurancePolicy.findMany({
    where: {
      orgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(tipo ? { tipo } : {}),
      ...expiringFilter,
    },
    include: {
      leaseContract: { select: { id: true } },
      property: { select: { id: true, rua: true, numero: true } },
    },
    orderBy: { vigenciaFim: "asc" },
    take: 200,
  });
  return NextResponse.json({ policies });
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSURANCE_MANAGE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, insurancePolicyCreateSchema);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.leaseContractId) {
    const lc = await prisma.leaseContract.findFirst({
      where: { id: parsed.data.leaseContractId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!lc) return NextResponse.json({ error: "Contrato não pertence à org." }, { status: 422 });
  }
  if (parsed.data.propertyId) {
    const p = await prisma.property.findFirst({
      where: { id: parsed.data.propertyId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!p) return NextResponse.json({ error: "Imóvel não pertence à org." }, { status: 422 });
  }

  const policy = await prisma.insurancePolicy.create({
    data: { ...parsed.data, orgId: ctx.orgId },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "INSURANCE_CREATE",
      result: "SUCCESS",
      resource: policy.id,
      resourceType: "InsurancePolicy",
      metadata: { tipo: policy.tipo, seguradora: policy.seguradora },
    }
  );

  return NextResponse.json({ policy }, { status: 201 });
}
