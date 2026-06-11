import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { checklistItemTogglePatchSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

interface ChecklistItem {
  titulo: string;
  status: "pendente" | "concluido" | "aprovado";
  responsavel?: string;
  concluidoAt?: string;
}

/**
 * PATCH item específico de um checklist. Atomicidade simulada — lemos, mutamos JSON,
 * salvamos. Concorrência rara (checklists operacionais).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CHECKLIST_MANAGE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const parsed = await parseJsonBody(req, checklistItemTogglePatchSchema);
  if (!parsed.ok) return parsed.response;

  const checklist = await prisma.checklist.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!checklist) return NextResponse.json({ error: "Checklist não encontrado" }, { status: 404 });

  const itens = Array.isArray(checklist.itensJson)
    ? ([...(checklist.itensJson as unknown as ChecklistItem[])])
    : [];
  const idx = parsed.data.index;
  if (idx < 0 || idx >= itens.length) {
    return NextResponse.json({ error: "Índice fora do range." }, { status: 422 });
  }

  itens[idx] = {
    ...itens[idx],
    status: parsed.data.status,
    responsavel: parsed.data.responsavel ?? itens[idx].responsavel,
    concluidoAt:
      parsed.data.status === "concluido" || parsed.data.status === "aprovado"
        ? new Date().toISOString()
        : undefined,
  };

  // Auto-conclui o checklist quando todos os itens obrigatórios são "concluido"/"aprovado".
  const allDone = itens.every((it) => it.status === "concluido" || it.status === "aprovado");
  const nextStatus = allDone ? "concluido" : checklist.status === "pendente" ? "em_andamento" : checklist.status;

  const updated = await prisma.checklist.update({
    where: { id },
    data: {
      itensJson: itens as unknown as object,
      status: nextStatus,
      completedAt: allDone ? new Date() : null,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: allDone ? "CHECKLIST_COMPLETE" : "CHECKLIST_ITEM_TOGGLE",
      result: "SUCCESS",
      resource: id,
      resourceType: "Checklist",
      metadata: { index: idx, status: parsed.data.status },
    }
  );

  return NextResponse.json({ checklist: updated });
}
