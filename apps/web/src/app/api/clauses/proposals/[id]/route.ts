import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createKnowledgeItem } from "@/lib/ai/knowledge";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as "accept" | "reject" | undefined;

  const proposal = await prisma.clauseProposal.findFirst({
    where: { id: params.id, orgId: org.id },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Proposta não encontrada" }, { status: 404 });
  }
  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: `Proposta já está ${proposal.status}` },
      { status: 400 }
    );
  }

  if (action === "reject") {
    await prisma.clauseProposal.update({
      where: { id: params.id },
      data: {
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: session.user.id,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "accept") {
    // Cria como KnowledgeItem (pós-unificação 2026-05-18). Embedding gerado
    // automaticamente em createKnowledgeItem se Voyage configurada.
    const result = await createKnowledgeItem({
      orgId: org.id,
      category: "clause",
      title: proposal.title,
      content: proposal.content,
      tags: proposal.tags,
      source: "ai_proposal",
      createdBy: session.user.id,
      subcategory: proposal.category || "customizada",
      groupCode: proposal.groupCode,
      isVariable: !!proposal.groupCode,
      agentNotes: proposal.reason,
      status: "approved",
    });

    await prisma.clauseProposal.update({
      where: { id: params.id },
      data: {
        status: "approved",
        resolvedAt: new Date(),
        resolvedBy: session.user.id,
      },
    });

    // `clauseId` no response mantido por retrocompat com UI consumer; aponta
    // pro KnowledgeItem.parentId (mesma row no caso de chunkTotal=1).
    return NextResponse.json({ ok: true, clauseId: result.parentId });
  }

  return NextResponse.json(
    { error: "action deve ser 'accept' ou 'reject'" },
    { status: 400 }
  );
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

  await prisma.clauseProposal.deleteMany({
    where: { id: params.id, orgId: org.id },
  });
  return NextResponse.json({ ok: true });
}
