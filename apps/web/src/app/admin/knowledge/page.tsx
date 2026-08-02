import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { KnowledgeBaseClient } from "@/components/settings/KnowledgeBaseClient";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Base de conhecimento da plataforma — Admin" };

/**
 * Base de conhecimento UNIVERSAL (`KnowledgeItem.orgId IS NULL`) + a visão
 * que faltava: cobertura por escopo×categoria e a base de QUALQUER tenant em
 * leitura (`?orgId=`). Até aqui ver o RAG de um tenant exigia impersonation.
 *
 * A leitura por tenant é server-rendered e read-only DE PROPÓSITO: o
 * KnowledgeBaseClient de edição resolve a org pela SESSÃO (rotas
 * /api/knowledge/*), então reusá-lo aqui editaria a org do admin, não a
 * selecionada. Escrever na base de um tenant continua sendo do tenant — ou
 * via impersonation, que deixa rastro próprio.
 *
 * `support` (categoria) fica fora: é a base do assistente de produto e tem
 * tela própria (/admin/support-ai) — misturar confundiria a contagem.
 */

interface SemEmbeddingRow {
  orgId: string | null;
  n: number;
}

export default async function PlatformKnowledgePage({
  searchParams,
}: {
  searchParams: { orgId?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  const where = {
    orgId: null,
    parentId: null,
    category: { not: "support" },
  } as const;

  const [items, counts, orgs, porEscopo, semEmbedding, usoPorOrg] =
    await Promise.all([
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
          usageCount: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.knowledgeItem.groupBy({
        by: ["category"],
        where,
        _count: { _all: true },
      }),
      prisma.organization.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.knowledgeItem.groupBy({
        by: ["orgId", "category"],
        where: { parentId: null, category: { not: "support" } },
        _count: { _all: true },
      }),
      // "Sem embedding" na MESMA unidade das outras colunas (item top-level):
      // conta o item cuja folha — ele mesmo, se não tem filhos, ou qualquer
      // chunk-filho — está sem vetor. Contar folhas cruas misturaria unidades
      // (1 doc de 5 chunks sem embedding apareceria como "5" ao lado de um
      // "1" na categoria — review #232); e `embedding IS NULL` sem olhar
      // filhos marcaria toda linha-mãe como faltante, alarme falso
      // permanente. A coluna é invisível ao Prisma (vector via migration
      // crua) — SQL direto.
      prisma.$queryRawUnsafe<SemEmbeddingRow[]>(
        `SELECT k."orgId", count(*)::int AS n
           FROM "KnowledgeItem" k
          WHERE k."parentId" IS NULL
            AND k.category <> 'support'
            AND (
              (k.embedding IS NULL AND NOT EXISTS (
                 SELECT 1 FROM "KnowledgeItem" c WHERE c."parentId" = k.id
               ))
              OR EXISTS (
                 SELECT 1 FROM "KnowledgeItem" c
                  WHERE c."parentId" = k.id AND c.embedding IS NULL
               )
            )
          GROUP BY k."orgId"`
      ),
      // Uso de ITENS DA PLATAFORMA pelo tenant — o filtro pelo orgId nulo do
      // item é o que faz a coluna dizer o que o rótulo promete. Sem ele, o
      // groupBy somaria também o uso das cláusulas próprias da org (review
      // #232) e "quanto este tenant depende do acervo universal" viraria
      // "quanto este tenant insere cláusula", outra pergunta.
      prisma.knowledgeItemUsage.groupBy({
        by: ["orgId"],
        where: { knowledgeItem: { orgId: null } },
        _sum: { count: true },
      }),
    ]);

  // ── Visão por tenant (read-only) ─────────────────────────────────────────
  const selectedOrgId = searchParams.orgId || null;
  const selectedOrg = selectedOrgId
    ? orgs.find((o) => o.id === selectedOrgId) ?? null
    : null;
  const tenantItems = selectedOrg
    ? await prisma.knowledgeItem.findMany({
        where: {
          orgId: selectedOrg.id,
          parentId: null,
          category: { not: "support" },
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
          id: true,
          category: true,
          title: true,
          chunkTotal: true,
          tags: true,
          source: true,
          usageCount: true,
          updatedAt: true,
        },
      })
    : [];

  // ── Tabela de cobertura ──────────────────────────────────────────────────
  const categorias = [...new Set(porEscopo.map((r) => r.category))].sort();
  const orgName = new Map<string | null, string>([
    [null, "Plataforma"],
    ...orgs.map((o) => [o.id, o.name] as [string, string]),
  ]);
  const linhas = new Map<string | null, Record<string, number>>();
  for (const r of porEscopo) {
    const row = linhas.get(r.orgId) ?? {};
    row[r.category] = r._count._all;
    linhas.set(r.orgId, row);
  }
  const faltandoEmbedding = new Map(semEmbedding.map((r) => [r.orgId, r.n]));
  const usos = new Map(usoPorOrg.map((r) => [r.orgId, r._sum.count ?? 0]));
  // Plataforma primeiro, depois orgs por nome; org sem item nenhum não aparece.
  const escopos: (string | null)[] = [
    null,
    ...orgs.filter((o) => linhas.has(o.id)).map((o) => o.id),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
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

      <section className="rounded-lg border">
        <div className="border-b px-4 py-2">
          <h2 className="text-sm font-medium">Cobertura por escopo</h2>
          <p className="text-xs text-muted-foreground">
            Clique num tenant pra ver a base dele (leitura — escrita é do
            tenant, ou via &quot;Testar como&quot;). &quot;Sem embedding&quot;
            = itens que só saem no fallback textual do RAG.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">Escopo</th>
                {categorias.map((c) => (
                  <th key={c} className="p-2 font-medium">
                    {c}
                  </th>
                ))}
                <th className="p-2 font-medium">Sem embedding</th>
                <th className="p-2 font-medium">Usos (itens da plataforma)</th>
              </tr>
            </thead>
            <tbody>
              {escopos.map((escopo) => (
                <tr key={escopo ?? "__platform"} className="border-t">
                  <td className="p-2 font-medium">
                    {escopo === null ? (
                      <span className="flex items-center gap-2">
                        Plataforma
                        {selectedOrgId && (
                          <Link
                            href="/admin/knowledge"
                            className="text-xs text-primary hover:underline"
                          >
                            ver
                          </Link>
                        )}
                      </span>
                    ) : (
                      <Link
                        href={`/admin/knowledge?orgId=${escopo}`}
                        className="hover:underline"
                      >
                        {orgName.get(escopo)}
                      </Link>
                    )}
                  </td>
                  {categorias.map((c) => (
                    <td key={c} className="p-2 tabular-nums">
                      {linhas.get(escopo)?.[c] ?? 0}
                    </td>
                  ))}
                  <td className="p-2 tabular-nums">
                    {(faltandoEmbedding.get(escopo) ?? 0) > 0 ? (
                      <span className="text-amber-600">
                        {faltandoEmbedding.get(escopo)}
                      </span>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="p-2 tabular-nums">
                    {escopo === null ? "—" : usos.get(escopo) ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedOrgId && !selectedOrg && (
        <p className="text-sm text-destructive">
          Org não encontrada — exibindo a base da plataforma.
        </p>
      )}

      {selectedOrg ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">
              Base de {selectedOrg.name}
            </h2>
            <Badge variant="secondary">leitura</Badge>
            <Link
              href="/admin/knowledge"
              className="text-xs text-primary hover:underline"
            >
              ← voltar pra plataforma
            </Link>
          </div>
          {tenantItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este tenant não tem itens próprios — a IA dele responde só com a
              base da plataforma.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Título</th>
                    <th className="p-2 font-medium">Categoria</th>
                    <th className="p-2 font-medium">Chunks</th>
                    <th className="p-2 font-medium">Usos</th>
                    <th className="p-2 font-medium">Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantItems.map((i) => (
                    <tr key={i.id} className="border-t">
                      <td className="max-w-md truncate p-2">{i.title}</td>
                      <td className="p-2">{i.category}</td>
                      <td className="p-2 tabular-nums">{i.chunkTotal}</td>
                      <td className="p-2 tabular-nums">{i.usageCount}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {i.updatedAt.toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
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
          orgCount={orgs.length}
        />
      )}
    </div>
  );
}
