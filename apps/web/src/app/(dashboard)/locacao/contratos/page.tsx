import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LocacaoContratosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const contracts = await prisma.leaseContract.findMany({
    where: { orgId: org.id, status: { in: ["ativo", "renovacao", "rescisao"] } },
    include: {
      property: { select: { rua: true, numero: true, cidade: true } },
      tenants: { include: { tenant: { select: { nome: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contratos ativos ({contracts.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum contrato ativo.</p>
        ) : (
          <ul className="divide-y">
            {contracts.map((lc) => (
              <li key={lc.id} className="py-2 text-sm">
                {lc.property.rua} {lc.property.numero} — {lc.tenants.map((t) => t.tenant.nome).join(", ")} · {lc.status}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
