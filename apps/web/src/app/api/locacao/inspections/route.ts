import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess,
  ensureLocacaoApiAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { inspectionCreateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.INSPECTION_VIEW, { scope: "locacao:r" });
  if (isRouteError(ctx)) return ctx;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  // Filtro por contrato: a popup de envio do contrato lista só as vistorias
  // DELE pra oferecer o laudo como documento extra do envelope.
  const leaseContractId = url.searchParams.get("leaseContractId");

  const inspections = await prisma.inspection.findMany({
    where: {
      orgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(leaseContractId ? { leaseContractId } : {}),
    },
    include: {
      property: { select: { id: true, rua: true, numero: true, cidade: true, uf: true } },
      leaseContract: { select: { id: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ inspections });
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSPECTION_CREATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, inspectionCreateSchema);
  if (!parsed.ok) return parsed.response;

  const p = await prisma.property.findFirst({
    where: { id: parsed.data.propertyId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!p) return NextResponse.json({ error: "Imóvel não pertence à org." }, { status: 422 });

  if (parsed.data.leaseContractId) {
    const lc = await prisma.leaseContract.findFirst({
      where: { id: parsed.data.leaseContractId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!lc) return NextResponse.json({ error: "Contrato não pertence à org." }, { status: 422 });
  }

  const inspection = await prisma.inspection.create({
    data: {
      orgId: ctx.orgId,
      propertyId: parsed.data.propertyId,
      leaseContractId: parsed.data.leaseContractId ?? null,
      tipo: parsed.data.tipo,
      tipoImovel: parsed.data.tipoImovel ?? null,
      executorId: parsed.data.executorId ?? null,
      status: parsed.data.scheduledFor ? "em_campo" : "rascunho",
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: parsed.data.scheduledFor ? "INSPECTION_SCHEDULE" : "INSPECTION_CREATE",
      result: "SUCCESS",
      resource: inspection.id,
      resourceType: "Inspection",
      metadata: { tipo: parsed.data.tipo, scheduledFor: parsed.data.scheduledFor?.toISOString() },
    }
  );

  return NextResponse.json({ inspection }, { status: 201 });
}
