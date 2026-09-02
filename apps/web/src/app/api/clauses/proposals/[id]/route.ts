import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { deriveIsVariable } from "@/lib/clauses/schema";
import { groupCodeForEsteira } from "@/lib/clauses/taxonomy";

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
    // `propose_new_clause` aceita `groupCode` como string livre
    // (`tool-handlers.ts`), então o modelo pode gravar qualquer coisa na
    // proposta. A guarda filtra contra o enum ANTES de virar cláusula.
    const grupoDoCcv = groupCodeForEsteira("venda", proposal.groupCode);

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
      groupCode: grupoDoCcv,
      // Um G1..G6 válido JÁ declara a esteira: o conjunto é FECHADO e é o
      // roteiro do CCV por definição. Não é a premissa que furou o backfill
      // ("ter algum groupCode ⇒ venda", que valia até para 'GARANTIA'); aqui a
      // inferência é sobre o enum, e grupo inventado pelo modelo virou `null`
      // logo acima. Sem grupo, a cláusula nasce em triagem — lida nas duas
      // esteiras, que é o default seguro.
      esteira: grupoDoCcv ? "venda" : null,
      // Derivado do CONTEÚDO. Era `!!proposal.groupCode`, sobra da época em que
      // "ter grupo" e "ter placeholder" eram tratados como a mesma coisa; a
      // migration 20260901120000 trocou a semântica no banco e este caminho
      // ficou para trás, gravando a antiga.
      isVariable: deriveIsVariable(proposal.content),
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
