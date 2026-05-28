import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { checklistCreateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CHECKLIST_VIEW);
  if (isRouteError(ctx)) return ctx;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const leaseContractId = url.searchParams.get("leaseContractId");

  const checklists = await prisma.checklist.findMany({
    where: {
      orgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(leaseContractId ? { leaseContractId } : {}),
    },
    include: {
      leaseContract: { select: { id: true, property: { select: { rua: true, numero: true } } } },
      template: { select: { id: true, nome: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ checklists });
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CHECKLIST_MANAGE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, checklistCreateSchema);
  if (!parsed.ok) return parsed.response;

  const lc = await prisma.leaseContract.findFirst({
    where: { id: parsed.data.leaseContractId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!lc) return NextResponse.json({ error: "Contrato não pertence à org." }, { status: 422 });

  if (parsed.data.templateId) {
    const t = await prisma.checklistTemplate.findFirst({
      where: { id: parsed.data.templateId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!t) return NextResponse.json({ error: "Template não encontrado." }, { status: 422 });
  }

  const checklist = await prisma.checklist.create({
    data: {
      orgId: ctx.orgId,
      leaseContractId: parsed.data.leaseContractId,
      templateId: parsed.data.templateId ?? null,
      nome: parsed.data.nome,
      itensJson: parsed.data.itens,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "CHECKLIST_CREATE",
      result: "SUCCESS",
      resource: checklist.id,
      resourceType: "Checklist",
    }
  );

  return NextResponse.json({ checklist }, { status: 201 });
}
