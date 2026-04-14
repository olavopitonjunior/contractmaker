import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET(
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

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const suggestions = await prisma.templateSuggestion.findMany({
    where: {
      templateId: params.id,
      orgId: org.id,
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json(suggestions);
}

export async function POST(
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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { title, reason, diffHunks, evidence } = body as {
    title?: string;
    reason?: string;
    diffHunks?: Array<{ before: string; after: string }>;
    evidence?: string[];
  };

  if (!title || !reason || !Array.isArray(diffHunks) || diffHunks.length === 0) {
    return NextResponse.json(
      { error: "title, reason e diffHunks são obrigatórios" },
      { status: 400 }
    );
  }

  // Verify template belongs to org
  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
    select: { id: true, handlebarsSource: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }

  // Sanity check: at least one hunk must match the current source
  const source = template.handlebarsSource;
  const valid = diffHunks.filter((h) => h.before && source.includes(h.before));
  if (valid.length === 0) {
    return NextResponse.json(
      { error: "Nenhum hunk válido — os trechos 'before' não existem no template atual" },
      { status: 400 }
    );
  }

  const suggestion = await prisma.templateSuggestion.create({
    data: {
      templateId: params.id,
      orgId: org.id,
      authorType: "user",
      userId: session.user.id,
      title,
      reason,
      diffHunks: valid as object,
      evidence: (evidence || []) as object,
    },
  });

  return NextResponse.json(suggestion, { status: 201 });
}
