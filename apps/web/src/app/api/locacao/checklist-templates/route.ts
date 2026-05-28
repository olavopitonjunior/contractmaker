import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { checklistTemplateCreateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await ensureLocacaoAccess(PERMISSION.CHECKLIST_VIEW);
  if (isRouteError(ctx)) return ctx;
  const templates = await prisma.checklistTemplate.findMany({
    where: { orgId: ctx.orgId, ativo: true },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CHECKLIST_TEMPLATE_MANAGE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, checklistTemplateCreateSchema);
  if (!parsed.ok) return parsed.response;

  const template = await prisma.checklistTemplate.create({
    data: {
      orgId: ctx.orgId,
      nome: parsed.data.nome,
      itensJson: parsed.data.itens,
      ativo: parsed.data.ativo,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "CHECKLIST_TEMPLATE_CREATE",
      result: "SUCCESS",
      resource: template.id,
      resourceType: "ChecklistTemplate",
    }
  );

  return NextResponse.json({ template }, { status: 201 });
}
