import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { NovaDespesaDialog } from "@/components/locacao/NovaDespesaDialog";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MES_LABEL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const TYPE_LABEL: Record<string, string> = {
  iptu: "IPTU",
  condominio: "Condomínio",
  seguro_incendio: "Seguro incêndio",
  seguro_fianca: "Seguro fiança",
  juros: "Juros",
  multa: "Multa",
  honorarios: "Honorários",
  atualizacao_monetaria: "Atualização monet.",
  custas: "Custas",
  moratorios: "Moratórios",
  taxa_locacao: "Taxa de locação",
  outro: "Outro",
};

export default async function LocacaoDespesasPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const params = (await searchParams) ?? {};
  const now = new Date();
  const monthParam = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;
  const [y, m] = monthParam
    ? monthParam.split("-").map(Number)
    : [now.getFullYear(), now.getMonth() + 1];

  const startOfMonth = new Date(y, m - 1, 1);
  const startOfNextMonth = new Date(y, m, 1);
  const prevMonth = new Date(y, m - 2, 1);
  const nextMonth = startOfNextMonth;
  const fmtMonthParam = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const [expenses, contracts] = await Promise.all([
    prisma.expense.findMany({
      where: {
        orgId: org.id,
        dueDate: { gte: startOfMonth, lt: startOfNextMonth },
      },
      include: {
        leaseContract: { select: { id: true, property: { select: { rua: true, numero: true } } } },
      },
      orderBy: { dueDate: "asc" },
      take: 500,
    }),
    prisma.leaseContract.findMany({
      where: { orgId: org.id, status: { in: ["ativo", "renovacao"] } },
      select: {
        id: true,
        property: { select: { rua: true, numero: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const totalMes = expenses.reduce((acc, e) => acc + e.valor, 0);
  const pendentes = expenses.filter((e) => e.status === "pendente").length;
  const atrasadas = expenses.filter((e) => e.status === "pendente" && e.dueDate < now).length;

  const contractOptions = contracts.map((c) => ({
    id: c.id,
    label: c.property
      ? `${c.property.rua ?? ""} ${c.property.numero ?? ""}`.trim() || c.id.slice(0, 8)
      : c.id.slice(0, 8),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">
            Despesas — {MES_LABEL[m - 1]}/{y}
          </h2>
          <p className="text-sm text-muted-foreground">
            {expenses.length} lançamento(s) · {pendentes} pendente(s) · {atrasadas} atrasada(s) · total{" "}
            <strong>{fmtBRL(totalMes)}</strong>
          </p>
        </div>
        <NovaDespesaDialog contracts={contractOptions} />
      </div>

      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/locacao/despesas?month=${fmtMonthParam(prevMonth)}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            {MES_LABEL[prevMonth.getMonth()].slice(0, 3)}/{prevMonth.getFullYear()}
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/locacao/despesas?month=${fmtMonthParam(nextMonth)}`}>
            {MES_LABEL[nextMonth.getMonth()].slice(0, 3)}/{nextMonth.getFullYear()}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {expenses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Sem despesas em {MES_LABEL[m - 1]}/{y}.
              {contractOptions.length === 0 && (
                <> Cadastre primeiro um contrato pra poder lançar despesas.</>
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {expenses.map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm hover:bg-muted/30"
                >
                  <div className="col-span-2">
                    <div className="font-medium">
                      {e.dueDate.toLocaleDateString("pt-BR")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {MES_LABEL[e.dueDate.getMonth()].slice(0, 3)}
                    </div>
                  </div>
                  <div className="col-span-5">
                    <div className="font-medium">
                      {TYPE_LABEL[e.type] ?? e.type}
                      {e.parcelaTotal > 1 ? ` · ${e.parcelaN}/${e.parcelaTotal}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {e.leaseContract?.property?.rua ?? "—"}{" "}
                      {e.leaseContract?.property?.numero ?? ""} ·{" "}
                      {e.debitoDe} → {e.creditoPara}
                    </div>
                  </div>
                  <div className="col-span-3 text-right font-semibold">{fmtBRL(e.valor)}</div>
                  <div className="col-span-2 text-right">
                    <Badge
                      variant={
                        e.status === "pago"
                          ? "default"
                          : e.status === "cancelado"
                            ? "outline"
                            : e.dueDate < now
                              ? "destructive"
                              : "secondary"
                      }
                    >
                      {e.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
