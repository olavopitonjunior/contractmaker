import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clause = await prisma.clause.findUnique({
    where: { id: params.id },
  });

  if (!clause) {
    return NextResponse.json({ error: "Clause not found" }, { status: 404 });
  }

  return NextResponse.json(clause);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clause = await prisma.clause.findUnique({
    where: { id: params.id },
  });

  if (!clause) {
    return NextResponse.json({ error: "Clause not found" }, { status: 404 });
  }

  const body = await req.json();

  const updated = await prisma.clause.update({
    where: { id: params.id },
    data: {
      title: body.title ?? clause.title,
      content: body.content ?? clause.content,
      description: body.description ?? clause.description,
      category: body.category ?? clause.category,
      subcategory: body.subcategory ?? clause.subcategory,
      groupCode: body.groupCode ?? clause.groupCode,
      isVariable: body.isVariable ?? clause.isVariable,
      agentNotes: body.agentNotes ?? clause.agentNotes,
      tags: body.tags ?? clause.tags,
      status: body.status ?? clause.status,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clause = await prisma.clause.findUnique({
    where: { id: params.id },
    include: { _count: { select: { contractClauses: true } } },
  });

  if (!clause) {
    return NextResponse.json({ error: "Clause not found" }, { status: 404 });
  }

  if (clause._count.contractClauses > 0) {
    await prisma.clause.update({
      where: { id: params.id },
      data: { status: "archived" },
    });
    return NextResponse.json({ status: "archived" });
  }

  await prisma.clause.delete({ where: { id: params.id } });
  return NextResponse.json({ status: "deleted" });
}
