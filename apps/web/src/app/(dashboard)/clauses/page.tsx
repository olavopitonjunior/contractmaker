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

  const rows = await prisma.knowledgeItem.findMany({
    where: {
      ...knowledgeScopeWhere(org.id),
      category: "clause",
      status: { not: "archived" },
    },
    orderBy: [{ subcategory: "asc" }, { title: "asc" }],
  });

  const clauses = rows.map((c) => ({
    ...c,
    category: c.subcategory ?? "customizada",
  }));

  return (
    <ClausesPageClient
      clauses={JSON.parse(JSON.stringify(clauses))}
      platformUpdates={platformUpdates}
    />
  );
}
