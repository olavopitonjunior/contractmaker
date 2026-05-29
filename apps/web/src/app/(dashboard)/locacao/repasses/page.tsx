import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send } from "lucide-react";
import { RealizarRepasseButton } from "@/components/locacao/RealizarRepasseButton";
import { AIInsightsCard } from "@/components/ai-assist/InsightsCard";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function LocacaoRepassesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // RentCharges pagas SEM repasse ainda — agrupar por proprietário.
  const pendentes = await prisma.rentCharge.findMany({
    where: { orgId: org.id, status: "paga", repasseTransferId: null },
    include: {
      leaseContract: {
        include: {
          property: {
            include: { ownerships: { include: { owner: true } } },
          },
        },
      },
    },
    orderBy: { paidAt: "asc" },
    take: 500,
  });

  // Agrupa por owner principal.
  const grupos = new Map<
    string,
    { ownerName: string; ownerId: string; items: typeof pendentes; total: number }
  >();
  for (const rc of pendentes) {
    const principal =
      rc.leaseContract?.property?.ownerships.find((o) => o.tipo === "proprietario_principal") ??
      rc.leaseContract?.property?.ownerships[0];
    const key = principal?.ownerId ?? "_sem_proprietario";
    const name = principal?.owner.nome ?? "Sem proprietário definido";
    if (!grupos.has(key)) {
      grupos.set(key, { ownerName: name, ownerId: key, items: [], total: 0 });
    }
    const g = grupos.get(key)!;
    g.items.push(rc);
    g.total += rc.valorBase + rc.encargos - rc.multa - rc.juros;
  }

  const totalGeral = Array.from(grupos.values()).reduce((acc, g) => acc + g.total, 0);
  const hoje = pendentes.filter((rc) => rc.paidAt && rc.paidAt >= startOfMonth).length;
  const atrasados = pendentes.length - hoje;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Repasses a realizar</h2>
        <p className="text-sm text-muted-foreground">
          {pendentes.length} cobrança(s) pagas aguardando repasse · {grupos.size} proprietário(s) ·{" "}
          {hoje} do mês · {atrasados} de meses anteriores · total{" "}
          <strong>{fmtBRL(totalGeral)}</strong>
        </p>
      </div>

      <AIInsightsCard context="cashflow" title="Insights de fluxo de caixa" />

      {pendentes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Send className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum repasse pendente. Quando uma cobrança Asaas for liquidada, o webhook marca{" "}
              <code className="text-xs">RentCharge.status=&quot;paga&quot;</code> e ela aparece aqui.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {Array.from(grupos.values()).map((g) => (
            <Card key={g.ownerId}>
              <CardContent className="p-0">
                <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                  <div>
                    <div className="font-medium">{g.ownerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.items.length} cobrança(s) · líquido{" "}
                      <strong className="text-foreground">{fmtBRL(g.total)}</strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{g.items.length}</Badge>
                    <RealizarRepasseButton
                      rentChargeIds={g.items.map((rc) => rc.id)}
                      label={g.items.length > 1 ? "Repasse agrupado" : "Realizar"}
                    />
                  </div>
                </div>
                <ul className="divide-y">
                  {g.items.map((rc) => {
                    const liquido = rc.valorBase + rc.encargos - rc.multa - rc.juros;
                    const enderecoFmt = rc.leaseContract?.property
                      ? `${rc.leaseContract.property.rua ?? ""} ${rc.leaseContract.property.numero ?? ""}`.trim()
                      : "—";
                    return (
                      <li
                        key={rc.id}
                        className="grid grid-cols-12 items-center gap-3 px-4 py-2 text-sm"
                      >
                        <div className="col-span-2">{rc.competencia}</div>
                        <div className="col-span-5 text-muted-foreground">{enderecoFmt}</div>
                        <div className="col-span-3 text-right text-xs text-muted-foreground">
                          pago em {rc.paidAt?.toLocaleDateString("pt-BR") ?? "—"}
                        </div>
                        <div className="col-span-2 text-right font-medium">{fmtBRL(liquido)}</div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
