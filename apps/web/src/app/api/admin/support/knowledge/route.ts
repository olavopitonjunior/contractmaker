import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { VoyageError } from "@/lib/ai/embeddings";
import { resolveSupportOrgId } from "@/lib/support/org";
import { SUPPORT_CATEGORY, SUPPORT_MODULE_TAGS } from "@/lib/support/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lista itens de nível superior da base de suporte (parentId null).
export async function GET(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  const orgId = await resolveSupportOrgId();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const tag = req.nextUrl.searchParams.get("tag")?.trim();

  const items = await prisma.knowledgeItem.findMany({
    where: {
      orgId,
      category: SUPPORT_CATEGORY,
      parentId: null,
      ...(tag ? { tags: { has: tag } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { content: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      content: true,
      tags: true,
      source: true,
      chunkTotal: true,
      updatedAt: true,
    },
  });

  // Total de itens de nível superior (sem filtro) pra o admin ver o estado real
  // da base + em qual org ela vive — teria tornado o bug de "seed no banco errado"
  // óbvio na hora.
  const total = await prisma.knowledgeItem.count({
    where: { orgId, category: SUPPORT_CATEGORY, parentId: null },
  });

  return NextResponse.json({
    orgId,
    count: total,
    items: items.map((i) => ({
      ...i,
      content: i.content.slice(0, 300),
      updatedAt: i.updatedAt.toISOString(),
    })),
  });
}

const postSchema = z.object({
  title: z.string().min(3).max(300),
  content: z.string().min(3).max(50000),
  tags: z.array(z.enum(SUPPORT_MODULE_TAGS)).min(1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const orgId = await resolveSupportOrgId();
  try {
    const { parentId, chunksCreated } = await createKnowledgeItem({
      orgId,
      category: SUPPORT_CATEGORY,
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags,
      source: "manual",
      createdBy: session!.user!.id,
    });
    return NextResponse.json({ id: parentId, chunks: chunksCreated });
  } catch (err) {
    if (err instanceof VoyageError) {
      return NextResponse.json(
        { error: "Falha ao gerar embedding", detail: err.message },
        { status: 502 }
      );
    }
    throw err;
  }
}
