import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { propertyCreateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.PROPERTY_VIEW);
  if (isRouteError(ctx)) return ctx;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const cidade = url.searchParams.get("cidade");

  const properties = await prisma.property.findMany({
    where: {
      orgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(cidade ? { cidade: { contains: cidade, mode: "insensitive" as const } } : {}),
    },
    include: {
      ownerships: { include: { owner: { select: { id: true, nome: true, cpfCnpj: true } } } },
      _count: { select: { leaseContracts: true, insurancePolicies: true, maintenances: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ properties });
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.PROPERTY_CREATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, propertyCreateSchema);
  if (!parsed.ok) return parsed.response;

  // Dedupe de import externo: mesmo registro do CRM já importado → 409 com o
  // id existente (a UI oferece abrir o cadastro em vez de duplicar).
  if (parsed.data.crmId) {
    const existing = await prisma.property.findFirst({
      where: { orgId: ctx.orgId, crmId: parsed.data.crmId },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "ALREADY_IMPORTED",
          message: "Este imóvel já foi importado do CRM.",
          propertyId: existing.id,
        },
        { status: 409 }
      );
    }
  }

  const property = await prisma.property.create({
    data: { ...parsed.data, orgId: ctx.orgId },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "PROPERTY_CREATE",
      result: "SUCCESS",
      resource: property.id,
      resourceType: "Property",
    }
  );

  return NextResponse.json({ property }, { status: 201 });
}
