import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { knowledgeScopeWhere } from "@/lib/ai/knowledge-scope";
import { findPlatformSlotUpdates } from "@/lib/knowledge/platform-slot-updates";
import { ClausesPageClient } from "@/components/clauses/ClausesPageClient";

export default async function ClausesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  // Pós-unificação 2026-05-18: biblioteca de cláusulas vive em KnowledgeItem
  // com category="clause". A subcategoria semântica (partes/objeto/preco/...)
  // que a UI usa pra agrupar fica em `subcategory` — re-exposta como `category`
  // pra retrocompat com ClausesPageClient (campos antigos preservados).
  // A geração nunca troca a cláusula da casa pela da plataforma; aqui a
  // imobiliária ao menos FICA SABENDO que existe versão mais recente.
  const platformUpdates = await findPlatformSlotUpdates(org.id).catch((err) => {
    console.error("[clauses] findPlatformSlotUpdates falhou (segue sem aviso):", err);
    return [];
  });

  // `select` explícito espelhando a interface Clause do client: sem ele, TODO
  // campo do KnowledgeItem (createdBy, visibleToAgents, chunk fields…) vazava
  // pro browser de qualquer tenant — e coluna interna futura vazaria por
  // default (achado de review).
  const rows = await prisma.knowledgeItem.findMany({
    where: {
      ...knowledgeScopeWhere(org.id),
      category: "clause",
      status: { not: "archived" },
    },
    select: {
      id: true,
      title: true,
      content: true,
      subcategory: true,
      groupCode: true,
      isVariable: true,
      agentNotes: true,
      tags: true,
      status: true,
      source: true,
      orgId: true,
      usageCount: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ subcategory: "asc" }, { title: "asc" }],
  });

  // Uso POR TENANT (KnowledgeItemUsage) — o usageCount global do KnowledgeItem
  // mistura orgs em cláusula de plataforma; a coluna "Uso" da tabela mostra o
  // que ESTA imobiliária consumiu.
  const usageRows = await prisma.knowledgeItemUsage.findMany({
    where: { orgId: org.id, knowledgeItemId: { in: rows.map((r) => r.id) } },
    select: { knowledgeItemId: true, count: true },
  });
  const usageById = new Map(usageRows.map((u) => [u.knowledgeItemId, u.count]));

  const clauses = rows.map((c) => ({
    ...c,
    description: null,
    category: c.subcategory ?? "customizada",
    orgUsageCount: usageById.get(c.id) ?? 0,
    // Datas como ISO string — a interface Clause do client tipa string e
    // Date cru não atravessa a fronteira RSC de forma estável.
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return (
    <ClausesPageClient
      clauses={clauses}
      platformUpdates={platformUpdates}
    />
  );
}
