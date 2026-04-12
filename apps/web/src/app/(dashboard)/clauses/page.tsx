import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ClausesPageClient } from "@/components/clauses/ClausesPageClient";

export default async function ClausesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  const clauses = await prisma.clause.findMany({
    where: { orgId: org.id, status: { not: "archived" } },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });

  return <ClausesPageClient clauses={JSON.parse(JSON.stringify(clauses))} />;
}
