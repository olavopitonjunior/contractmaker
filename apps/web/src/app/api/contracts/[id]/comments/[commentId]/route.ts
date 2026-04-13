import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; commentId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.resolved === "boolean") data.resolved = body.resolved;
  if (typeof body.text === "string") data.text = body.text;

  const comment = await prisma.contractComment.update({
    where: { id: params.commentId },
    data,
  });

  return NextResponse.json(comment);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; commentId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.contractComment.delete({ where: { id: params.commentId } });
  return NextResponse.json({ ok: true });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; commentId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.text) {
    return NextResponse.json({ error: "text é obrigatório" }, { status: 400 });
  }

  const parent = await prisma.contractComment.findUnique({
    where: { id: params.commentId },
  });
  if (!parent) {
    return NextResponse.json({ error: "Comentário pai não encontrado" }, { status: 404 });
  }

  const reply = await prisma.contractComment.create({
    data: {
      contractId: params.id,
      parentId: params.commentId,
      userId: session.user.id,
      authorName: session.user.name || session.user.email || "Usuário",
      authorType: "user",
      text: body.text,
      anchorId: parent.anchorId,
      selectedText: parent.selectedText,
    },
  });

  return NextResponse.json(reply, { status: 201 });
}
