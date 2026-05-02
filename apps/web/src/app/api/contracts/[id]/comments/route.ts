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

  // Quando o contrato é um Google Doc, espelha o comment no Drive Comments API.
  // Se o trecho não for encontrado no doc, falha 422 — sem isso o usuário cria
  // um comentário "fantasma" (existe no app mas sem âncora no doc visível).
  let googleCommentId: string | null = null;
  if (contract.googleDocId) {
    try {
      const { createAnchoredComment } = await import("@/lib/google/comments");
      const res = await createAnchoredComment({
        docId: contract.googleDocId,
        selectedText: body.selectedText,
        content: body.text,
      });
      googleCommentId = res.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[comments POST] Falha ao criar Drive comment:", err);
      if (msg.includes("Texto-âncora não encontrado")) {
        return NextResponse.json(
          { error: "Trecho de referência não encontrado no contrato. Copie o texto exato do Google Doc." },
          { status: 422 }
        );
      }
      return NextResponse.json(
        { error: `Falha ao criar comentário no Google Doc: ${msg.slice(0, 200)}` },
        { status: 502 }
      );
    }
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
      googleCommentId,
    },
  });

  return NextResponse.json(comment, { status: 201 });
}
