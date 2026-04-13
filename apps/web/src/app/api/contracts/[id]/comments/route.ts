import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeResolved = url.searchParams.get("includeResolved") === "true";

  const comments = await prisma.contractComment.findMany({
    where: {
      contractId: params.id,
      ...(includeResolved ? {} : { resolved: false }),
      parentId: null,
    },
    include: {
      replies: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(comments);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.text || !body?.selectedText) {
    return NextResponse.json({ error: "text e selectedText são obrigatórios" }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({ where: { id: params.id } });
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  if (contract.status === "aprovado") {
    return NextResponse.json({ error: "Contrato aprovado não pode receber comentários" }, { status: 403 });
  }

  const comment = await prisma.contractComment.create({
    data: {
      contractId: params.id,
      userId: session.user.id,
      authorName: session.user.name || session.user.email || "Usuário",
      authorType: "user",
      text: body.text,
      anchorId: randomUUID(),
      selectedText: body.selectedText,
      severity: body.severity || "info",
    },
  });

  return NextResponse.json(comment, { status: 201 });
}
