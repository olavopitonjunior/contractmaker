import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { maintenanceCreateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.MAINTENANCE_VIEW);
  if (isRouteError(ctx)) return ctx;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const propertyId = url.searchParams.get("propertyId");

  const maintenances = await prisma.maintenance.findMany({
    where: {
      orgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(propertyId ? { propertyId } : {}),
    },
    include: { property: { select: { id: true, rua: true, numero: true } } },
    orderBy: { abertaEm: "desc" },
    take: 200,
  });
  return NextResponse.json({ maintenances });
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.MAINTENANCE_MANAGE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, maintenanceCreateSchema);
  if (!parsed.ok) return parsed.response;

  const p = await prisma.property.findFirst({
    where: { id: parsed.data.propertyId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!p) return NextResponse.json({ error: "Imóvel não pertence à org." }, { status: 422 });

  const maintenance = await prisma.maintenance.create({
    data: { ...parsed.data, orgId: ctx.orgId },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "MAINTENANCE_CREATE",
      result: "SUCCESS",
      resource: maintenance.id,
      resourceType: "Maintenance",
      metadata: { tipo: maintenance.tipo, propertyId: maintenance.propertyId },
    }
  );

  return NextResponse.json({ maintenance }, { status: 201 });
}
