import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { AplicarReajusteDialog } from "@/components/locacao/AplicarReajusteDialog";
import { ReajusteAprovarButton } from "@/components/locacao/ReajustarAprovarButton";
import { EmptyState } from "@/components/data-table/empty-state";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  proposto: "secondary",
  aprovado: "secondary",
  aplicado: "default",
  recusado: "outline",
};

interface Params {
  params: Promise<{ id: string }>;
}

export default async function ReajustesPage({ params }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");
  const { id } = await params;

  const lease = await prisma.leaseContract.findFirst({
    where: { id, orgId: org.id },
    include: {
      readjustments: { orderBy: { dataReajuste: "desc" } },
      property: { select: { rua: true, numero: true } },
    },
  });
  if (!lease) notFound();

  const enderecoFmt = lease.property
    ? `${lease.property.rua ?? ""} ${lease.property.numero ?? ""}`.trim()
    : "—";

  return (
    <div className="space-y-4">
      <Link
        href={`/locacao/contratos/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para o contrato
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Reajustes do contrato</h2>
          <p className="text-sm text-muted-foreground">
            {enderecoFmt} · valor atual <strong>{fmtBRL(lease.valorAluguel)}</strong>
            {lease.dataProximoReajuste && (
              <> · próximo reajuste em {lease.dataProximoReajuste.toLocaleDateString("pt-BR")}</>
            )}
          </p>
        </div>
        <AplicarReajusteDialog
          leaseId={lease.id}
          defaultIndice={lease.indiceReajuste}
          valorAtual={lease.valorAluguel}
        />
      </div>

      {lease.readjustments.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="h-10 w-10" />}
          title="Nenhum reajuste aplicado"
          description="Use o botão acima pra propor ou aplicar o reajuste agora. O cron mensal também sugere propostas automáticas em D+0 do mês da data prevista."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {lease.readjustments.map((r) => (
                <li key={r.id} className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm">
                  <div className="col-span-2">
                    <div className="font-medium">{r.dataReajuste.toLocaleDateString("pt-BR")}</div>
                    <div className="text-xs text-muted-foreground">{r.indice}</div>
                  </div>
                  <div className="col-span-2 text-center">
                    <div className="font-semibold">{r.percentualAplicado.toFixed(2)}%</div>
                  </div>
                  <div className="col-span-4 text-right">
                    <div className="text-xs text-muted-foreground">
                      De {fmtBRL(r.valorAnterior)}
                    </div>
                    <div className="font-semibold">→ {fmtBRL(r.valorNovo)}</div>
                  </div>
                  <div className="col-span-2 text-center">
                    <Badge variant={STATUS_TONE[r.status] ?? "outline"}>{r.status}</Badge>
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    {r.status === "proposto" && (
                      <>
                        <ReajusteAprovarButton
                          leaseId={lease.id}
                          readjustmentId={r.id}
                          action="approve"
                        />
                        <ReajusteAprovarButton
                          leaseId={lease.id}
                          readjustmentId={r.id}
                          action="reject"
                        />
                      </>
                    )}
                  </div>
                  {r.observacao && (
                    <div className="col-span-12 text-xs italic text-muted-foreground">
                      {r.observacao}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
