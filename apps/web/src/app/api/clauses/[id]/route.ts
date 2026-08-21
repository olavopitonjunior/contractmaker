import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { updateKnowledgeItem } from "@/lib/ai/knowledge";
import { clauseWriteSchema, normalizeClauseBody } from "@/lib/clauses/schema";
import { resolveUserOrgId } from "@/lib/security/org-scope";

/**
 * /api/clauses/[id] — pós-unificação 2026-05-18 opera contra KnowledgeItem
 * com category="clause". URL preservada pra retrocompat de UI.
 *
 * Escopo multitenant: a cláusula só é visível/editável pela org dona. O
 * filtro por orgId do USUÁRIO (não da cláusula) é o que impede escrita
 * cross-org — antes o PATCH passava `clause.orgId` (da vítima) pro check
 * interno do updateKnowledgeItem, que sempre batia.
 */
async function findClause(id: string, userId: string) {
  const orgId = await resolveUserOrgId(userId);
  if (!orgId) return null;
  return prisma.knowledgeItem.findFirst({
    where: { id, category: "clause", orgId },
  });
}

function shape(row: { subcategory: string | null } & Record<string, unknown>) {
  return { ...row, category: row.subcategory ?? "customizada" };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clause = await findClause(params.id, session.user.id);
  if (!clause) {
    return NextResponse.json({ error: "Clause not found" }, { status: 404 });
  }

  return NextResponse.json(shape(clause));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clause = await findClause(params.id, session.user.id);
  if (!clause) {
    return NextResponse.json({ error: "Clause not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  // `category` aqui no body é a subcategoria semântica (partes/objeto/...).
  // `.partial()`: PATCH só valida o que veio — campo ausente mantém o atual.
  const parsed = clauseWriteSchema.partial().safeParse(normalizeClauseBody(body));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const data = parsed.data;
  await updateKnowledgeItem(params.id, clause.orgId, {
    title: data.title ?? clause.title,
    content: data.content ?? clause.content,
    tags: data.tags ?? clause.tags,
    subcategory: data.subcategory ?? clause.subcategory,
    groupCode: data.groupCode === undefined ? clause.groupCode : data.groupCode,
    isVariable: data.isVariable ?? clause.isVariable,
    agentNotes: data.agentNotes === undefined ? clause.agentNotes : data.agentNotes,
    status: data.status ?? clause.status,
  });

  const updated = await prisma.knowledgeItem.findUnique({ where: { id: params.id } });
  return NextResponse.json(updated ? shape(updated) : null);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await resolveUserOrgId(session.user.id);
  if (!orgId) {
    return NextResponse.json({ error: "Clause not found" }, { status: 404 });
  }
  const clause = await prisma.knowledgeItem.findFirst({
    where: { id: params.id, category: "clause", orgId },
    include: { _count: { select: { contractClauses: true } } },
  });

  if (!clause) {
    return NextResponse.json({ error: "Clause not found" }, { status: 404 });
  }

  if (clause._count.contractClauses > 0) {
    await prisma.knowledgeItem.update({
      where: { id: params.id },
      data: { status: "archived" },
    });
    return NextResponse.json({ status: "archived" });
  }

  await prisma.knowledgeItem.delete({ where: { id: params.id } });
  return NextResponse.json({ status: "deleted" });
}
