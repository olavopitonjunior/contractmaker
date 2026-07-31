/**
 * "Testar RAG" no escopo da PLATAFORMA.
 *
 * Não dá pra reaproveitar /api/knowledge/search: aquele monta um AgentContext
 * com a org do usuário e devolve org + plataforma juntas. Aqui o ponto é ver o
 * que a base universal responde SOZINHA — senão o super_admin não consegue
 * distinguir um acerto da plataforma de um acerto da própria org dele.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { embedOne, toPgVector, isEmbeddingsConfigured, VoyageError } from "@/lib/ai/embeddings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  query: z.string().min(1).max(500),
  category: z.string().max(40).optional(),
  topK: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "query obrigatória" }, { status: 400 });
  }
  const { query, category } = parsed.data;
  const topK = parsed.data.topK ?? 5;

  if (!isEmbeddingsConfigured()) {
    const items = await prisma.knowledgeItem.findMany({
      where: {
        orgId: null,
        // `support` fica fora, igual à listagem e ao helper de escopo: são ~37
        // itens de "como usar a tela X" que nenhum agente jurídico vê, e que
        // misturados aqui fariam o super_admin achar que a base está poluída.
        category: category ?? { not: "support" },
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      take: topK,
      select: { id: true, title: true, content: true, category: true },
    });
    return NextResponse.json({
      mode: "keyword_fallback",
      results: items.map((i) => ({ ...i, content: i.content.slice(0, 800) })),
    });
  }

  try {
    const vec = toPgVector(await embedOne(query, "query"));
    const params: unknown[] = [vec];
    let where = `"orgId" IS NULL AND embedding IS NOT NULL`;
    if (category) {
      params.push(category);
      where += ` AND category = $${params.length}`;
    } else {
      // Ver a nota do fallback acima.
      where += ` AND category <> 'support'`;
    }
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; title: string; content: string; category: string; similarity: number }>
    >(
      `
      SELECT id, title, content, category,
             1 - (embedding <=> $1::vector) AS similarity
      FROM "KnowledgeItem"
      WHERE ${where}
      ORDER BY embedding <=> $1::vector
      LIMIT ${topK}
      `,
      ...params
    );
    return NextResponse.json({
      mode: "semantic",
      results: rows.map((r) => ({
        ...r,
        content: r.content.slice(0, 800),
        similarity: Number(r.similarity?.toFixed?.(3) ?? r.similarity),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Busca falhou",
        detail: err instanceof VoyageError ? err.message : String(err).slice(0, 200),
      },
      { status: 502 }
    );
  }
}
