import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  propertyId: string;
  orgId: string;
}

interface MonthBucket {
  competencia: string;
  receitas: number;
  despesas: number;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function competenciaOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function fmtCompetencia(c: string): string {
  const [y, m] = c.split("-");
  const meses = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${meses[Number(m) - 1]}/${y.slice(2)}`;
}

export async function ExtratoImovelCard({ propertyId, orgId }: Props) {
  const leases = await prisma.leaseContract.findMany({
    where: { propertyId, orgId },
    select: { id: true },
  });
  const leaseIds = leases.map((l) => l.id);

  if (leaseIds.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extrato consolidado</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sem contratos vinculados — sem movimentações.
          </p>
        </CardContent>
      </Card>
    );
  }

  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);

  const [paidCharges, paidExpenses] = await Promise.all([
    prisma.rentCharge.findMany({
      where: {
        leaseContractId: { in: leaseIds },
        status: "paga",
        paidAt: { gte: cutoff, not: null },
      },
      select: { paidAt: true, valorBase: true, encargos: true, multa: true, juros: true },
    }),
    prisma.expense.findMany({
      where: {
        propertyId,
        orgId,
        status: "pago",
        paidAt: { gte: cutoff, not: null },
      },
      select: { paidAt: true, valor: true },
    }),
  ]);

  const map = new Map<string, MonthBucket>();
  function bucketFor(comp: string): MonthBucket {
    let b = map.get(comp);
    if (!b) {
      b = { competencia: comp, receitas: 0, despesas: 0 };
      map.set(comp, b);
    }
    return b;
  }
  for (const c of paidCharges) {
    if (!c.paidAt) continue;
    const comp = competenciaOf(c.paidAt);
    bucketFor(comp).receitas += c.valorBase + c.encargos + c.multa + c.juros;
  }
  for (const e of paidExpenses) {
    if (!e.paidAt) continue;
    const comp = competenciaOf(e.paidAt);
    bucketFor(comp).despesas += e.valor;
  }

  const buckets = Array.from(map.values()).sort((a, b) =>
    b.competencia.localeCompare(a.competencia)
  );

  const currentYear = new Date().getUTCFullYear();
  const ytdReceitas = paidCharges
    .filter((c) => c.paidAt && c.paidAt.getUTCFullYear() === currentYear)
    .reduce((acc, c) => acc + c.valorBase + c.encargos + c.multa + c.juros, 0);
  const ytdDespesas = paidExpenses
    .filter((e) => e.paidAt && e.paidAt.getUTCFullYear() === currentYear)
    .reduce((acc, e) => acc + e.valor, 0);
  const ytdLiquido = ytdReceitas - ytdDespesas;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Extrato consolidado (últimos 12 meses)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-md bg-emerald-50 p-3 dark:bg-emerald-950/30">
            <div className="text-xs text-muted-foreground">Receitas {currentYear}</div>
            <div className="font-semibold text-emerald-700 dark:text-emerald-400">
              {fmtBRL(ytdReceitas)}
            </div>
          </div>
          <div className="rounded-md bg-rose-50 p-3 dark:bg-rose-950/30">
            <div className="text-xs text-muted-foreground">Despesas {currentYear}</div>
            <div className="font-semibold text-rose-700 dark:text-rose-400">
              - {fmtBRL(ytdDespesas)}
            </div>
          </div>
          <div className="rounded-md bg-primary/10 p-3">
            <div className="text-xs text-primary">Líquido {currentYear}</div>
            <div className="font-semibold text-primary">{fmtBRL(ytdLiquido)}</div>
          </div>
        </div>

        {buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem receitas/despesas pagas nos últimos 12 meses.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Competência</th>
                  <th className="py-2 text-right">Receitas</th>
                  <th className="py-2 text-right">Despesas</th>
                  <th className="py-2 text-right">Líquido</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => {
                  const liquido = b.receitas - b.despesas;
                  return (
                    <tr key={b.competencia} className="border-b last:border-b-0">
                      <td className="py-2 font-medium">{fmtCompetencia(b.competencia)}</td>
                      <td className="py-2 text-right text-emerald-700 dark:text-emerald-400">
                        {fmtBRL(b.receitas)}
                      </td>
                      <td className="py-2 text-right text-rose-700 dark:text-rose-400">
                        - {fmtBRL(b.despesas)}
                      </td>
                      <td
                        className={`py-2 text-right font-medium ${
                          liquido < 0 ? "text-rose-700 dark:text-rose-400" : ""
                        }`}
                      >
                        {fmtBRL(liquido)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
