import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { knowledgeScopeWhere } from "@/lib/ai/knowledge-scope";
import { VoyageError } from "@/lib/ai/embeddings";

const VALID_CATEGORIES = ["legislation", "model", "rule", "glossary", "clause"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

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
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("q");

  // Lê a base da org + a de plataforma. A UI marca as de plataforma como
  // somente-leitura — o PATCH/DELETE já filtra por `orgId` concreto, então
  // mostrar não é o mesmo que deixar editar.
  const where: Record<string, unknown> = {
    ...knowledgeScopeWhere(org.id),
    parentId: null, // top-level items only; chunks stay hidden
  };
  if (category && VALID_CATEGORIES.includes(category as Category)) {
    where.category = category;
  }
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { content: { contains: search, mode: "insensitive" } },
    ];
  }

  const items = await prisma.knowledgeItem.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      category: true,
      title: true,
      content: true,
      chunkTotal: true,
      tags: true,
      source: true,
      orgId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Counts per category for the sidebar
  const counts = await prisma.knowledgeItem.groupBy({
    by: ["category"],
    where: { ...knowledgeScopeWhere(org.id), parentId: null },
    _count: { _all: true },
  });
  const countsMap = Object.fromEntries(
    counts.map((c) => [c.category, c._count._all])
  );

  return NextResponse.json({ items, counts: countsMap });
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

  const { title, content, category, tags, source } = body as {
    title?: string;
    content?: string;
    category?: string;
    tags?: string[];
    source?: string;
  };

  if (!title || !content || !category) {
    return NextResponse.json(
      { error: "title, content e category são obrigatórios" },
      { status: 400 }
    );
  }
  if (!VALID_CATEGORIES.includes(category as Category)) {
    return NextResponse.json(
      { error: `category deve ser: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const result = await createKnowledgeItem({
      orgId: org.id,
      category: category as Category,
      title,
      content,
      tags: Array.isArray(tags) ? tags : [],
      source: source || "manual",
      createdBy: session.user.id,
    });

    return NextResponse.json({
      id: result.parentId,
      chunksCreated: result.chunksCreated,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof VoyageError) {
      return NextResponse.json(
        {
          error: `Falha ao gerar embedding: ${err.message}`,
          code: err.code,
        },
        { status: 502 }
      );
    }
    console.error("[knowledge POST]", err);
    return NextResponse.json(
      { error: "Erro ao criar item da base de conhecimento" },
      { status: 500 }
    );
  }
}
