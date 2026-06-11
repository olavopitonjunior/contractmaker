import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { propertyUpdateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.PROPERTY_VIEW);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      ownerships: { include: { owner: true } },
      leaseContracts: {
        select: { id: true, status: true, valorAluguel: true, vigenciaInicio: true, vigenciaFim: true },
      },
      insurancePolicies: true,
      maintenances: { orderBy: { abertaEm: "desc" }, take: 20 },
      expenses: { orderBy: { dueDate: "desc" }, take: 50 },
    },
  });
  if (!property) {
    return NextResponse.json({ error: "Imóvel não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ property });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.PROPERTY_EDIT);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const parsed = await parseJsonBody(req, propertyUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const existing = await prisma.property.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!existing) {
    return NextResponse.json({ error: "Imóvel não encontrado" }, { status: 404 });
  }

  const property = await prisma.property.update({
    where: { id },
    data: parsed.data,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "PROPERTY_UPDATE",
      result: "SUCCESS",
      resource: id,
      resourceType: "Property",
      metadata: { fields: Object.keys(parsed.data) },
    }
  );

  return NextResponse.json({ property });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.PROPERTY_DELETE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.property.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { _count: { select: { leaseContracts: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Imóvel não encontrado" }, { status: 404 });
  }
  if (existing._count.leaseContracts > 0) {
    return NextResponse.json(
      { error: "Imóvel possui contratos vinculados — não pode ser excluído." },
      { status: 409 }
    );
  }

  await prisma.property.delete({ where: { id } });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "PROPERTY_DELETE",
      result: "SUCCESS",
      resource: id,
      resourceType: "Property",
    }
  );

  return NextResponse.json({ ok: true });
}
