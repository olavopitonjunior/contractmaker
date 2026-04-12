import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ExternalLink } from "lucide-react";
import { FormsActions } from "@/components/forms/FormsActions";

export default async function FormsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  const forms = await prisma.salesForm.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
    include: { deal: { select: { id: true, title: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Formularios</h1>
        <Button asChild>
          <Link href="/forms/new">
            <Plus className="mr-2 h-4 w-4" />
            Novo Formulario
          </Link>
        </Button>
      </div>

      {forms.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">
              Nenhum formulario criado ainda.
            </p>
            <Button asChild>
              <Link href="/forms/new">Criar Primeiro Formulario</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {forms.map((form) => (
            <Card key={form.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium truncate mr-2">
                  {form.title || `Formulario ${form.token.slice(0, 8)}...`}
                </CardTitle>
                <Badge
                  variant={
                    form.status === "completo"
                      ? "default"
                      : form.status === "vinculado"
                      ? "outline"
                      : "secondary"
                  }
                >
                  {form.status}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-1">
                  Criado em {form.createdAt.toLocaleDateString("pt-BR")}
                </p>
                {form.deal && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Negocio:{" "}
                    <Link
                      href={`/deals/${form.deal.id}`}
                      className="text-primary hover:underline"
                    >
                      {form.deal.title}
                    </Link>
                  </p>
                )}
                <FormsActions
                  formId={form.id}
                  token={form.token}
                  status={form.status}
                  hasDeal={!!form.deal}
                  dealId={form.deal?.id}
                  title={form.title}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
