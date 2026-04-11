import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const GROUP_LABELS: Record<string, string> = {
  G1: "G1 — Sinal, Arras e Início de Pagamento",
  G2: "G2 — Imissão na Posse",
  G3: "G3 — Rescisão e Condição Resolutiva",
  G4: "G4 — Financiamento e Registro",
  G5: "G5 — Comissão de Corretagem",
  G6: "G6 — Declarações e Disposições Especiais",
};

export default async function ClausesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organização.</p>;

  const clauses = await prisma.clause.findMany({
    where: { orgId: org.id },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });

  // Separate variable (banco v2) from legacy/fixed clauses
  const variableClauses = clauses.filter((c) => c.isVariable && c.groupCode);
  const fixedClauses = clauses.filter((c) => !c.isVariable);

  // Group variable clauses by groupCode
  const groupedVariable = variableClauses.reduce(
    (acc, clause) => {
      const group = clause.groupCode!;
      if (!acc[group]) acc[group] = [];
      acc[group].push(clause);
      return acc;
    },
    {} as Record<string, typeof clauses>
  );

  // Group fixed clauses by category
  const groupedFixed = fixedClauses.reduce(
    (acc, clause) => {
      if (!acc[clause.category]) acc[clause.category] = [];
      acc[clause.category].push(clause);
      return acc;
    },
    {} as Record<string, typeof clauses>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Biblioteca de Cláusulas</h1>
      </div>

      {/* Variable Clauses (Banco Padronizado v2) */}
      {Object.keys(groupedVariable).length > 0 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-primary">
            Banco de Cláusulas Padronizadas
          </h2>

          {["G1", "G2", "G3", "G4", "G5", "G6"].map((groupCode) => {
            const items = groupedVariable[groupCode];
            if (!items?.length) return null;
            return (
              <div key={groupCode} className="space-y-3">
                <h3 className="text-base font-medium">
                  {GROUP_LABELS[groupCode] || groupCode}
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((clause) => (
                    <Card key={clause.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">{clause.title}</CardTitle>
                          <div className="flex gap-1">
                            <Badge variant="outline" className="text-xs">
                              {clause.groupCode}
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
                      <CardContent className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {clause.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        {clause.agentNotes && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer font-medium">
                              Orientação de uso
                            </summary>
                            <p className="mt-1 pl-2 border-l-2 border-muted">
                              {clause.agentNotes}
                            </p>
                          </details>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fixed/Legacy Clauses */}
      {Object.keys(groupedFixed).length > 0 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-muted-foreground">
            Cláusulas Base
          </h2>

          {Object.entries(groupedFixed).map(([category, items]) => (
            <div key={category} className="space-y-3">
              <h3 className="text-base font-medium capitalize">{category}</h3>
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
      )}
    </div>
  );
}
