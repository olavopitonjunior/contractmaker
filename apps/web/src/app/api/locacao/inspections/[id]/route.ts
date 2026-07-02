import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { inspectionUpdateSchema } from "@/lib/locacao/validators";
import {
  canTransitionInspection,
  isInspectionContentEditable,
} from "@/lib/locacao/inspection-types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSPECTION_VIEW);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const inspection = await prisma.inspection.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      property: {
        select: { id: true, rua: true, numero: true, bairro: true, cidade: true, uf: true },
      },
      leaseContract: { select: { id: true, dealId: true } },
    },
  });
  if (!inspection) {
    return NextResponse.json({ error: "Vistoria não encontrada" }, { status: 404 });
  }
  return NextResponse.json({ inspection });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSPECTION_EXECUTE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.inspection.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Vistoria não encontrada" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, inspectionUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const hasContent = data.ambientesJson !== undefined || data.checklistJson !== undefined;
  if (hasContent && !isInspectionContentEditable(existing.status)) {
    return NextResponse.json(
      { error: `Laudo em "${existing.status}" não pode ser editado.` },
      { status: 422 }
    );
  }
  if (data.status && !canTransitionInspection(existing.status, data.status)) {
    return NextResponse.json(
      { error: `Transição ${existing.status} → ${data.status} não permitida.` },
      { status: 422 }
    );
  }

  // 1º save de conteúdo num rascunho promove pra em_campo.
  const status =
    data.status ?? (hasContent && existing.status === "rascunho" ? "em_campo" : undefined);

  const inspection = await prisma.inspection.update({
    where: { id },
    data: {
      ...(data.ambientesJson !== undefined ? { ambientesJson: data.ambientesJson } : {}),
      ...(data.checklistJson !== undefined ? { checklistJson: data.checklistJson } : {}),
      ...(data.executorId !== undefined ? { executorId: data.executorId } : {}),
      ...(status ? { status } : {}),
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "INSPECTION_UPDATE",
      result: "SUCCESS",
      resource: id,
      resourceType: "Inspection",
      metadata: {
        de: existing.status,
        para: inspection.status,
        conteudo: hasContent,
      },
    }
  );

  return NextResponse.json({ inspection });
}
