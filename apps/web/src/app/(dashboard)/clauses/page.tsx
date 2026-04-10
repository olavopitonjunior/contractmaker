import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ClausesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  const clauses = await prisma.clause.findMany({
    where: { orgId: org.id },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });

  const grouped = clauses.reduce(
    (acc, clause) => {
      if (!acc[clause.category]) acc[clause.category] = [];
      acc[clause.category].push(clause);
      return acc;
    },
    {} as Record<string, typeof clauses>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Biblioteca de Clausulas</h1>
      </div>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="space-y-3">
          <h2 className="text-lg font-medium capitalize">{category}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((clause) => (
              <Card key={clause.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{clause.title}</CardTitle>
                    <div className="flex gap-1">
                      <Badge variant="outline" className="text-xs">
                        {clause.source}
                      </Badge>
                      <Badge
                        variant={
                          clause.status === "approved"
                            ? "default"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {clause.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {clause.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
