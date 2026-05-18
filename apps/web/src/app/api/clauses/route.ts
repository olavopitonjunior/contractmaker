import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createKnowledgeItem } from "@/lib/ai/knowledge";

/**
 * /api/clauses — biblioteca de cláusulas padronizadas da org.
 * Pós-unificação 2026-05-18, lê/escreve em KnowledgeItem com category="clause".
 * URL preservada por retrocompat com UI legado (/clauses page + components).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json([]);

  const { searchParams } = new URL(req.url);
  // O filtro `category` daqui é a categoria semântica antiga (partes/objeto/...)
  // que agora vive em `subcategory` no KnowledgeItem.
  const subcategory = searchParams.get("category");
  const search = searchParams.get("q");

  const clauses = await prisma.knowledgeItem.findMany({
    where: {
      orgId: org.id,
      category: "clause",
      status: "approved",
      ...(subcategory ? { subcategory } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { content: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ subcategory: "asc" }, { usageCount: "desc" }],
  });

  // Shape compatível com a UI legada: expõe `category` = subcategoria semântica
  // pra não quebrar consumers que filtram por partes/objeto/preco/...
  const shaped = clauses.map((c) => ({
    ...c,
    category: c.subcategory ?? "customizada",
  }));

  return NextResponse.json(shaped);
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

  const body = await req.json();

  const result = await createKnowledgeItem({
    orgId: org.id,
    category: "clause",
    title: body.title,
    content: body.content,
    tags: Array.isArray(body.tags) ? body.tags : [],
    source: body.source || "manual",
    createdBy: session.user.id,
    subcategory: body.category || body.subcategory || "customizada",
    groupCode: body.groupCode ?? null,
    agentNotes: body.agentNotes ?? body.description ?? null,
    isVariable: !!body.isVariable,
    status: body.source === "ai-generated" ? "pending" : "approved",
  });

  const created = await prisma.knowledgeItem.findUnique({
    where: { id: result.parentId },
  });

  return NextResponse.json(
    created ? { ...created, category: created.subcategory ?? "customizada" } : null,
    { status: 201 }
  );
}
