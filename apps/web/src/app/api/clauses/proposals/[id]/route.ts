import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

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
    // Create the clause in the library
    const clause = await prisma.clause.create({
      data: {
        orgId: org.id,
        authorId: session.user.id,
        title: proposal.title,
        content: proposal.content,
        description: `Criada a partir de proposta IA — ${proposal.reason.slice(0, 200)}`,
        category: proposal.category || "customizada",
        groupCode: proposal.groupCode,
        isVariable: !!proposal.groupCode,
        agentNotes: proposal.reason,
        tags: proposal.tags,
        status: "approved",
        source: "ai_proposal",
      },
    });

    await prisma.clauseProposal.update({
      where: { id: params.id },
      data: {
        status: "approved",
        resolvedAt: new Date(),
        resolvedBy: session.user.id,
      },
    });

    return NextResponse.json({ ok: true, clauseId: clause.id });
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
