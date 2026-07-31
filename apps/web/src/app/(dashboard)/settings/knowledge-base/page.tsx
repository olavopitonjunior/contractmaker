import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { knowledgeScopeWhere } from "@/lib/ai/knowledge-scope";
import { KnowledgeBaseClient } from "@/components/settings/KnowledgeBaseClient";

export default async function KnowledgeBasePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/settings");

  const [items, counts] = await Promise.all([
    prisma.knowledgeItem.findMany({
      where: { ...knowledgeScopeWhere(org.id), parentId: null },
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
    }),
    prisma.knowledgeItem.groupBy({
      by: ["category"],
      where: { ...knowledgeScopeWhere(org.id), parentId: null },
      _count: { _all: true },
    }),
  ]);

  const countsMap = Object.fromEntries(
    counts.map((c) => [c.category, c._count._all])
  );

  const embeddingsConfigured = !!process.env.VOYAGE_API_KEY;

  return (
    <KnowledgeBaseClient
      initialItems={items.map((i) => ({
        ...i,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      }))}
      initialCounts={countsMap}
      embeddingsConfigured={embeddingsConfigured}
    />
  );
}
