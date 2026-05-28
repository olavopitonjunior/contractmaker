import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function LocacaoDespesasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const expenses = await prisma.expense.findMany({
    where: {
      orgId: org.id,
      dueDate: { gte: startOfMonth, lt: startOfNextMonth },
    },
    include: {
      leaseContract: { select: { property: { select: { rua: true, numero: true } } } },
    },
    orderBy: { dueDate: "asc" },
    take: 200,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Despesas do mês ({expenses.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma despesa no mês.</p>
        ) : (
          <ul className="divide-y">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div>
                    {e.type} {e.parcelaTotal > 1 ? `(${e.parcelaN}/${e.parcelaTotal})` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.leaseContract?.property?.rua ?? "—"} {e.leaseContract?.property?.numero ?? ""}
                    {" — "}
                    {e.dueDate.toLocaleDateString("pt-BR")}
                  </div>
                </div>
                <div className="font-medium">{fmtBRL(e.valor)}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
