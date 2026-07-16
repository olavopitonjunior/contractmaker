import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  orgScopedNotFound,
  resolveUserOrgId,
} from "@/lib/security/org-scope";

/**
 * Carrega o comentário validando (a) que pertence ao contrato da URL e
 * (b) que o contrato pertence à org do usuário. Cross-org/mismatch → null.
 */
async function loadScopedComment(
  commentId: string,
  contractId: string,
  userId: string
) {
  const orgId = await resolveUserOrgId(userId);
  if (!orgId) return null;
  const comment = await prisma.contractComment.findUnique({
    where: { id: commentId },
    include: {
      contract: {
        select: {
          id: true,
          googleDocId: true,
          deal: { select: { pipeline: { select: { orgId: true } } } },
        },
      },
    },
  });
  if (
    !comment ||
    comment.contract.id !== contractId ||
    comment.contract.deal.pipeline.orgId !== orgId
  ) {
    return null;
  }
  return comment;
}

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

  const existing = await loadScopedComment(
    params.commentId,
    params.id,
    session.user.id
  );
  if (!existing) {
    return orgScopedNotFound("Comentário");
  }

  // Editar o texto é só do autor; resolver/reabrir qualquer membro da org
  // pode (fluxo normal pra comentários de IA e de colegas).
  if (
    typeof body.text === "string" &&
    existing.authorType === "user" &&
    existing.userId !== session.user.id
  ) {
    return NextResponse.json(
      { error: "Só o autor pode editar o texto do comentário" },
      { status: 403 }
    );
  }

  // Espelha resolve no Drive Comments quando o doc é Google Docs.
  if (
    existing.googleCommentId &&
    existing.contract?.googleDocId &&
    typeof body.resolved === "boolean" &&
    body.resolved === true
  ) {
    try {
      const { resolveComment } = await import("@/lib/google/comments");
      await resolveComment(existing.contract.googleDocId, existing.googleCommentId);
    } catch (err) {
      console.error("[comments PATCH] Falha ao resolver Drive comment:", err);
    }
  }

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

  const existing = await loadScopedComment(
    params.commentId,
    params.id,
    session.user.id
  );
  if (!existing) {
    return orgScopedNotFound("Comentário");
  }

  if (existing.googleCommentId && existing.contract?.googleDocId) {
    try {
      const { deleteComment } = await import("@/lib/google/comments");
      await deleteComment(existing.contract.googleDocId, existing.googleCommentId);
    } catch (err) {
      console.error("[comments DELETE] Falha ao remover Drive comment:", err);
    }
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

  const parent = await loadScopedComment(
    params.commentId,
    params.id,
    session.user.id
  );
  if (!parent) {
    return orgScopedNotFound("Comentário pai");
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
