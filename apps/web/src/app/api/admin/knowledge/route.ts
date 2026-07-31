/**
 * Base de conhecimento da PLATAFORMA (`KnowledgeItem.orgId IS NULL`).
 *
 * Espelha /api/knowledge, trocando o escopo da org pelo da plataforma e o gate
 * de sessão pelo de `super_admin`. É o único caminho de ESCRITA em item que
 * todos os tenants leem — por isso o gate é o mais forte que existe, e não
 * `support` como no resto de /admin/*.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { VoyageError } from "@/lib/ai/embeddings";
import { AGENT_KEYS } from "@/lib/ai/agents/registry";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_CATEGORIES = [
  "legislation",
  "model",
  "rule",
  "glossary",
  "clause",
] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  const category = req.nextUrl.searchParams.get("category");
  const search = req.nextUrl.searchParams.get("q");

  // `support` tem tela própria (/admin/support-ai) e não é conhecimento
  // jurídico — fica fora desta listagem, igual ao helper de escopo.
  const where: Record<string, unknown> = {
    orgId: null,
    parentId: null,
    category: { not: "support" },
  };
  if (category && (VALID_CATEGORIES as readonly string[]).includes(category)) {
    where.category = category;
  }
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { content: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, counts] = await Promise.all([
    prisma.knowledgeItem.findMany({
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
        visibleToAgents: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.knowledgeItem.groupBy({
      by: ["category"],
      where: { orgId: null, parentId: null, category: { not: "support" } },
      _count: { _all: true },
    }),
  ]);

  return NextResponse.json({
    items,
    counts: Object.fromEntries(counts.map((c) => [c.category, c._count._all])),
  });
}

const postSchema = z.object({
  category: z.enum(VALID_CATEGORIES),
  title: z.string().min(1).max(300),
  content: z.string().min(1),
  tags: z.array(z.string().max(60)).max(20).optional(),
  source: z.string().max(300).optional(),
  // Vazio = visível a todos os agentes. Só aceita chave conhecida: um typo aqui
  // esconderia o item de todo mundo, em silêncio.
  visibleToAgents: z.array(z.enum(AGENT_KEYS)).max(AGENT_KEYS.length).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const { parentId, chunksCreated } = await createKnowledgeItem({
      orgId: null,
      allowPlatformScope: true,
      category: parsed.data.category,
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags ?? [],
      source: parsed.data.source ?? "manual",
      createdBy: session!.user!.id,
    });

    if (parsed.data.visibleToAgents?.length) {
      await prisma.knowledgeItem.updateMany({
        where: { OR: [{ id: parentId }, { parentId }] },
        data: { visibleToAgents: parsed.data.visibleToAgents },
      });
    }

    // Escrita que TODOS os tenants passam a ler merece rastro. `AuditContext.orgId`
    // é nullable, mas o extrator exige string — mesmo remendo de /api/admin/agents.
    await audit(
      { ...extractAuditContextFromRequest(req, "", session!.user!.id), orgId: null },
      {
        action: "PLATFORM_KNOWLEDGE_CREATE",
        result: "SUCCESS",
        resourceType: "KnowledgeItem",
        resource: parentId,
        metadata: { category: parsed.data.category, title: parsed.data.title },
      }
    );

    return NextResponse.json({ id: parentId, chunks: chunksCreated }, { status: 201 });
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
