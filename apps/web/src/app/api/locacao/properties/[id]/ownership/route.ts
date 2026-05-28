import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { propertyOwnershipReplaceSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * PUT substitui o conjunto inteiro de ownerships do imóvel.
 * Refine na validation garante que a soma dos % = 100 e há no máximo 1 principal.
 * Atomicidade via transação: delete + createMany.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.PROPERTY_OWNERSHIP_MANAGE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!property) {
    return NextResponse.json({ error: "Imóvel não encontrado" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, propertyOwnershipReplaceSchema);
  if (!parsed.ok) return parsed.response;

  // Confere que todos os owners citados pertencem à org (cross-org guard).
  const ownerIds = parsed.data.ownerships.map((o) => o.ownerId);
  const validOwners = await prisma.propertyOwner.findMany({
    where: { id: { in: ownerIds }, orgId: ctx.orgId },
    select: { id: true },
  });
  if (validOwners.length !== ownerIds.length) {
    return NextResponse.json(
      { error: "Um ou mais proprietários não pertencem à sua organização." },
      { status: 422 }
    );
  }

  await prisma.$transaction([
    prisma.propertyOwnership.deleteMany({ where: { propertyId: id } }),
    prisma.propertyOwnership.createMany({
      data: parsed.data.ownerships.map((o) => ({
        orgId: ctx.orgId,
        propertyId: id,
        ownerId: o.ownerId,
        percentual: o.percentual,
        tipo: o.tipo,
      })),
    }),
  ]);

  const ownerships = await prisma.propertyOwnership.findMany({
    where: { propertyId: id },
    include: { owner: { select: { id: true, nome: true, cpfCnpj: true } } },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "PROPERTY_OWNERSHIP_UPDATE",
      result: "SUCCESS",
      resource: id,
      resourceType: "Property",
      metadata: { count: ownerships.length },
    }
  );

  return NextResponse.json({ ownerships });
}
