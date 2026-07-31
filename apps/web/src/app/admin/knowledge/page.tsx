import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { KnowledgeBaseClient } from "@/components/settings/KnowledgeBaseClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Base de conhecimento da plataforma — Admin" };

/**
 * Base de conhecimento UNIVERSAL (`KnowledgeItem.orgId IS NULL`).
 *
 * Todo tenant lê o que estiver aqui, somado à própria base — com a do tenant
 * ganhando o desempate no ranking. Escrita é só `super_admin`; leitura segue o
 * resto de /admin/* (`support`), pra quem dá suporte poder conferir o que a IA
 * está vendo sem poder mexer.
 */
export default async function PlatformKnowledgePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  // `support` é a base do assistente de produto e tem tela própria
  // (/admin/support-ai) — misturar as duas aqui só confundiria a contagem.
  const where = {
    orgId: null,
    parentId: null,
    category: { not: "support" },
  } as const;

  const [items, counts, orgCount] = await Promise.all([
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
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.knowledgeItem.groupBy({
      by: ["category"],
      where,
      _count: { _all: true },
    }),
    prisma.organization.count(),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold">
          Base de conhecimento da plataforma
        </h1>
        <p className="text-sm text-muted-foreground">
          O que for criado aqui aparece na base de{" "}
          <strong>todas as imobiliárias</strong>, marcado como &quot;Plataforma&quot;
          e somente-leitura pra elas. Na busca semântica, empate de similaridade
          é desempatado a favor do conteúdo da própria imobiliária. Já numa
          cláusula de <strong>slot de template</strong> a regra é mais forte: a
          cláusula da imobiliária sempre vence, e a universal só preenche
          lacuna — o texto do slot entra no contrato e congela.
        </p>
      </header>

      <KnowledgeBaseClient
        scope="platform"
        initialItems={items.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
        }))}
        initialCounts={Object.fromEntries(
          counts.map((c) => [c.category, c._count._all])
        )}
        embeddingsConfigured={!!process.env.VOYAGE_API_KEY}
        orgCount={orgCount}
      />
    </div>
  );
}
