import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  updateKnowledgeItem,
  deleteKnowledgeItem,
  KnowledgeItemNotFoundError,
} from "@/lib/ai/knowledge";
import { VoyageError } from "@/lib/ai/embeddings";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const item = await prisma.knowledgeItem.findFirst({
    where: { id: params.id, orgId: org.id },
    include: {
      chunks: {
        select: { id: true, title: true, chunkIndex: true, content: true },
        orderBy: { chunkIndex: "asc" },
      },
    },
  });
  if (!item) {
    return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });
  }
  return NextResponse.json(item);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  try {
    await updateKnowledgeItem(params.id, org.id, {
      title: typeof body.title === "string" ? body.title : undefined,
      content: typeof body.content === "string" ? body.content : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof KnowledgeItemNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof VoyageError) {
      return NextResponse.json(
        { error: `Falha no embedding: ${err.message}`, code: err.code },
        { status: 502 }
      );
    }
    console.error("[knowledge PATCH]", err);
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  // 404 quando o escopo não casou: sem isso o 200 dizia "apagado" pra quem
  // tentou remover item de OUTRO escopo (ex.: linha de plataforma).
  const removed = await deleteKnowledgeItem(params.id, org.id);
  if (!removed) {
    return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
