import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LocacaoImoveisPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const properties = await prisma.property.findMany({
    where: { orgId: org.id },
    include: {
      ownerships: { include: { owner: { select: { id: true, nome: true } } } },
      _count: { select: { leaseContracts: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Imóveis ({properties.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum imóvel cadastrado. Use a API <code>POST /api/locacao/properties</code> ou aguarde a UI completa do designer.
          </p>
        ) : (
          <ul className="divide-y">
            {properties.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium">
                    {p.rua ?? "—"} {p.numero ?? ""} ({p.cidade ?? "—"}/{p.uf ?? "—"})
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.kind} · {p.status} ·{" "}
                    {p.ownerships.map((o) => `${o.owner.nome} (${o.percentual}%)`).join(", ") || "sem proprietários"}
                  </div>
                </div>
                <div className="text-xs">{p._count.leaseContracts} contratos</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
