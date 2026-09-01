import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { knowledgeScopeWhere } from "@/lib/ai/knowledge-scope";
import {
  clauseWriteSchema,
  normalizeClauseBody,
  deriveIsVariable,
} from "@/lib/clauses/schema";

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
      ...knowledgeScopeWhere(org.id),
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

  const body = await req.json().catch(() => ({}));
  // Default do POST (a UI velha às vezes não mandava subcategoria).
  const normalized = normalizeClauseBody(body);
  if (normalized.subcategory === undefined) normalized.subcategory = "customizada";
  const parsed = clauseWriteSchema.safeParse(normalized);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const result = await createKnowledgeItem({
    orgId: org.id,
    category: "clause",
    title: data.title,
    content: data.content,
    tags: data.tags ?? [],
    source: data.source || "manual",
    createdBy: session.user.id,
    subcategory: data.subcategory,
    groupCode: data.groupCode ?? null,
    esteira: data.esteira ?? null,
    agentNotes: data.agentNotes ?? null,
    // Derivado do conteúdo — o client não opina (ver `deriveIsVariable`).
    isVariable: deriveIsVariable(data.content),
    // Invariante: origem ai-generated SEMPRE nasce pending (revisão humana) —
    // status vindo do client não pode furar o gate (achado de review; approved
    // é filtro duro do RAG/expert-context/resolveClauseSlots).
    status:
      data.source === "ai-generated" ? "pending" : (data.status ?? "approved"),
  });

  const created = await prisma.knowledgeItem.findUnique({
    where: { id: result.parentId },
  });

  return NextResponse.json(
    created ? { ...created, category: created.subcategory ?? "customizada" } : null,
    { status: 201 }
  );
}
