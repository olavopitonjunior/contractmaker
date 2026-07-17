import Link from "next/link";
import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFunnelByChannel, type FunnelRow } from "@/lib/pipeline/funnel";

export const dynamic = "force-dynamic";

/**
 * /relatorios/funil — origem dos negócios por canal (Deal.sourceChannel).
 * Primeiro consumidor da dimensão de funil escrita nos 11 pontos de criação.
 * Server component: a query agregada roda direto (lib/pipeline/funnel.ts).
 */

const PERIODS: Array<{ key: string; label: string; days: number | null }> = [
  { key: "30d", label: "30 dias", days: 30 },
  { key: "90d", label: "90 dias", days: 90 },
  { key: "12m", label: "12 meses", days: 365 },
  { key: "all", label: "Tudo", days: null },
];

// Compacto pt-BR ("R$ 1,5 mi") — Intl, não toFixed (que renderiza decimal
// com ponto num app inteiro em vírgula).
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
function fmtBRL(v: number): string {
  return brlCompact.format(v);
}

function FunnelTable({ rows, kind }: { rows: FunnelRow[]; kind: "venda" | "locacao" }) {
  if (rows.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        Nenhum negócio no período.
      </p>
    );
  }
  const maxTotal = Math.max(...rows.map((r) => r.total));
  const wonLabel = kind === "venda" ? "Ganhos" : "Em ADM";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs">
          <tr>
            <th className="text-left p-2">Canal</th>
            <th className="text-right p-2">Criados</th>
            <th className="text-right p-2">{wonLabel}</th>
            <th className="text-right p-2">Perdidos</th>
            <th className="text-right p-2">Conversão</th>
            <th className="text-right p-2">Valor</th>
            <th className="p-2 w-[30%]" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel ?? "__null"} className="border-t">
              <td className="p-2 font-medium">
                {r.label}
                {r.channel === null && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    (antes do rastreio de canal)
                  </span>
                )}
              </td>
              <td className="text-right p-2 tabular-nums">{r.total}</td>
              <td className="text-right p-2 tabular-nums text-green-700">{r.won}</td>
              <td className="text-right p-2 tabular-nums text-red-700">{r.lost}</td>
              <td className="text-right p-2 tabular-nums">
                <Badge
                  variant="outline"
                  className={
                    r.conversionPct >= 50
                      ? "border-green-500 text-green-700"
                      : r.conversionPct >= 20
                        ? "border-amber-500 text-amber-700"
                        : ""
                  }
                >
                  {r.conversionPct}%
                </Badge>
              </td>
              <td className="text-right p-2 tabular-nums">{fmtBRL(r.totalValue)}</td>
              <td className="p-2">
                <div className="h-2 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-primary/70"
                    style={{ width: `${maxTotal > 0 ? (r.total / maxTotal) * 100 : 0}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function FunilPage({
  searchParams,
}: {
  searchParams?: { periodo?: string; kind?: string };
}) {
  // Gate de entitlement + org resolvida pelo SUBDOMÍNIO (não "primeira
  // membership") — mesmo padrão da página de Propostas. Redireciona quem não
  // tem nenhum dos pipelines habilitados.
  const { orgId, enabled } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PIPELINE,
    FEATURE.LOCACAO_PIPELINE,
  ]);
  const hasVendas = enabled[FEATURE.VENDAS_PIPELINE] === true;
  const hasLocacao = enabled[FEATURE.LOCACAO_PIPELINE] === true;

  const period =
    PERIODS.find((p) => p.key === searchParams?.periodo) ?? PERIODS[1]; // default 90d
  // Default segue o entitlement: tenant só-locação cai direto em locação.
  const kind =
    searchParams?.kind === "locacao" || (!hasVendas && hasLocacao)
      ? ("locacao" as const)
      : ("venda" as const);
  const from = period.days
    ? new Date(Date.now() - period.days * 24 * 60 * 60_000)
    : undefined;

  const rows = await getFunnelByChannel({ orgId, kind, from });
  const totals = rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      won: a.won + r.won,
      lost: a.lost + r.lost,
      value: a.value + r.totalValue,
    }),
    { total: 0, won: 0, lost: 0, value: 0 }
  );

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ periodo: period.key, kind, ...over });
    return `/relatorios/funil?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Origem dos negócios"
        description="De onde vêm os negócios e quanto cada canal converte. Canal capturado na criação do deal."
      />

      {/* Filtros: esteira + período (links server-side, sem client JS) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border overflow-hidden">
          {(["venda", "locacao"] as const)
            .filter((k) => (k === "venda" ? hasVendas : hasLocacao))
            .map((k) => (
            <Link
              key={k}
              href={qs({ kind: k })}
              className={`px-3 py-1.5 text-sm ${
                kind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {k === "venda" ? "Vendas" : "Locação"}
            </Link>
            ))}
        </div>
        <div className="flex rounded-md border overflow-hidden">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={qs({ periodo: p.key })}
              className={`px-3 py-1.5 text-sm ${
                period.key === p.key
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 sm:max-w-3xl">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums">{totals.total}</p>
            <p className="text-xs text-muted-foreground">Negócios criados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums text-green-700">{totals.won}</p>
            <p className="text-xs text-muted-foreground">
              {kind === "venda" ? "Comissão paga" : "Em ADM"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums text-red-700">{totals.lost}</p>
            <p className="text-xs text-muted-foreground">Perdidos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums">{fmtBRL(totals.value)}</p>
            <p className="text-xs text-muted-foreground">Valor somado</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Por canal de origem</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <FunnelTable rows={rows} kind={kind} />
        </CardContent>
      </Card>
    </div>
  );
}
