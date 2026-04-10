import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function TemplatesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  const templates = await prisma.contractTemplate.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Templates de Contrato</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{template.name}</CardTitle>
                <div className="flex gap-1">
                  {template.isDefault && (
                    <Badge>Padrao</Badge>
                  )}
                  <Badge variant="outline">v{template.version}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {template.description || "Sem descricao"}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Schema: {template.schemaType}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
