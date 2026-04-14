import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";

  const proposals = await prisma.clauseProposal.findMany({
    where: {
      orgId: org.id,
      ...(status === "all" ? {} : { status }),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json(proposals);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { title, content, reason, groupCode, category, tags, evidence } = body as {
    title?: string;
    content?: string;
    reason?: string;
    groupCode?: string;
    category?: string;
    tags?: string[];
    evidence?: string[];
  };

  if (!title || !content || !reason) {
    return NextResponse.json(
      { error: "title, content e reason são obrigatórios" },
      { status: 400 }
    );
  }

  const proposal = await prisma.clauseProposal.create({
    data: {
      orgId: org.id,
      authorType: "user",
      userId: session.user.id,
      title,
      content,
      reason,
      groupCode: groupCode ?? null,
      category: category ?? null,
      tags: Array.isArray(tags) ? tags : [],
      evidence: (evidence || []) as object,
    },
  });

  return NextResponse.json(proposal, { status: 201 });
}
