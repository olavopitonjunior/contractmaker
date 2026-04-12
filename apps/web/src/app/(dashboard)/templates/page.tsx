import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Pencil } from "lucide-react";

export default async function TemplatesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  const templates = await prisma.contractTemplate.findMany({
    where: { orgId: org.id, status: { not: "archived" } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates de Contrato</h1>
        <Button size="sm" asChild>
          <Link href="/templates/new">
            <Plus className="mr-1.5 h-4 w-4" />
            Novo Template
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Link key={template.id} href={`/templates/${template.id}`}>
            <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{template.name}</CardTitle>
                  <div className="flex gap-1">
                    {template.isDefault && <Badge>Padrao</Badge>}
                    <Badge variant="outline">v{template.version}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {template.description || "Sem descricao"}
                </p>
                <div className="flex items-center justify-between mt-3">
                  <Badge variant="secondary" className="text-xs">
                    {template.modalidade === "financiamento" ? "Financiamento" : "A Vista"}
                  </Badge>
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Nenhum template encontrado.</p>
          <p className="text-sm mt-1">Crie um novo template para comecar.</p>
        </div>
      )}
    </div>
  );
}
