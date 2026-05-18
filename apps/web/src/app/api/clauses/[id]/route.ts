import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { updateKnowledgeItem } from "@/lib/ai/knowledge";

/**
 * /api/clauses/[id] — pós-unificação 2026-05-18 opera contra KnowledgeItem
 * com category="clause". URL preservada pra retrocompat de UI.
 */
async function findClause(id: string) {
  return prisma.knowledgeItem.findFirst({
    where: { id, category: "clause" },
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

  const clause = await findClause(params.id);
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

  const clause = await findClause(params.id);
  if (!clause) {
    return NextResponse.json({ error: "Clause not found" }, { status: 404 });
  }

  const body = await req.json();

  // `category` aqui no body é a subcategoria semântica (partes/objeto/...).
  await updateKnowledgeItem(params.id, clause.orgId, {
    title: body.title ?? clause.title,
    content: body.content ?? clause.content,
    tags: body.tags ?? clause.tags,
    subcategory: body.category ?? body.subcategory ?? clause.subcategory,
    groupCode: body.groupCode ?? clause.groupCode,
    isVariable: body.isVariable ?? clause.isVariable,
    agentNotes: body.agentNotes ?? body.description ?? clause.agentNotes,
    status: body.status ?? clause.status,
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

  const clause = await prisma.knowledgeItem.findFirst({
    where: { id: params.id, category: "clause" },
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
