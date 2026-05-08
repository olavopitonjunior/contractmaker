import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default async function ContractsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  const contracts = await prisma.contract.findMany({
    where: {
      userId: session.user.id,
      isLatest: true,
    },
    orderBy: { updatedAt: "desc" },
    include: {
      deal: true,
      template: true,
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Contratos</h1>

      {contracts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">
              Nenhum contrato gerado ainda. Crie um negocio no pipeline e clique
              em "Confeccionar Contrato".
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {contracts.map((contract) => (
            <Link key={contract.id} href={`/contracts/${contract.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-sm">
                      {contract.deal.title}
                    </p>
                    <Badge variant="secondary">v{contract.version}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {contract.template?.name ?? "Contrato importado"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Atualizado em{" "}
                    {contract.updatedAt.toLocaleDateString("pt-BR")}
                  </p>
                  <Badge className="mt-2" variant="outline">
                    {contract.status}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
