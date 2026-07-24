"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2, Clock, XCircle, Star, AlertTriangle } from "lucide-react";

/**
 * FiancaComparativoCard — exibe o comparativo CONSOLIDADO de fiança (SegurosJá + Alpop)
 * que o Max grava em `Guarantee.dadosJson` (saída do consolidate.js do mcp-fianca).
 *
 * Read-only. Cards por fonte (✓/⏳/✗) + tabela de opções ordenada por prêmio. Fonte
 * `wip`/`pending` NÃO vira linha vazia — vira aviso. Tolera 1 fonte.
 */

export interface FiancaOpcao {
  fonte: string;
  seguradora: string;
  plano?: string | null;
  premioMensal?: number | null;
  premioAnual?: number | null;
  pctAluguelMes?: number | null;
}

export interface FiancaFonte {
  fonte: string;
  seguradora: string;
  status: "ok" | "wip" | "pending" | "rejected" | "expirada" | "error";
  veredito?: string | null;
  reason?: string | null;
  resumo?: string | null;
}

export interface FiancaConsolidado {
  completo?: boolean;
  fontes?: FiancaFonte[];
  opcoes?: FiancaOpcao[];
  melhorOpcao?: FiancaOpcao | null;
  divergencias?: string[];
  pendencias?: string[];
}

function fmtBRL(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function StatusIcon({ status }: { status: FiancaFonte["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "wip" || status === "pending") return <Clock className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function isMelhor(o: FiancaOpcao, melhor: FiancaOpcao | null | undefined): boolean {
  if (!melhor) return false;
  return o.fonte === melhor.fonte && (o.plano ?? null) === (melhor.plano ?? null) && o.premioAnual === melhor.premioAnual;
}

export function FiancaComparativoCard({ consolidado }: { consolidado: FiancaConsolidado | null | undefined }) {
  const fontes = consolidado?.fontes ?? [];
  const opcoes = consolidado?.opcoes ?? [];

  // Sem dados: nenhuma análise rodada ainda.
  if (!consolidado || fontes.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Shield className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Nenhuma análise de fiança registrada pelo Max.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Solicite uma análise via WhatsApp para ver o comparativo SegurosJá + Alpop aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  const allPending = fontes.every((f) => f.status === "wip" || f.status === "pending");

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4" /> Fiança — comparativo consolidado
          </h4>
          {consolidado.completo === false && (
            <Badge variant="secondary" className="text-amber-700">em andamento</Badge>
          )}
        </div>

        {/* Cards por fonte */}
        <div className="grid gap-3 sm:grid-cols-2">
          {fontes.map((f) => (
            <div key={f.fonte} className="space-y-1 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{f.seguradora}</span>
                <StatusIcon status={f.status} />
              </div>
              <p className="text-xs text-muted-foreground">{f.resumo ?? f.reason ?? f.status}</p>
            </div>
          ))}
        </div>

        {/* Tabela de opções (fontes 'ok'). */}
        {opcoes.length > 0 ? (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-muted-foreground">
                    <th className="p-3 text-left">Opção</th>
                    <th className="p-3 text-left">Fonte</th>
                    <th className="p-3 text-right">%</th>
                    <th className="p-3 text-right">Prêmio/mês</th>
                    <th className="p-3 text-right">Prêmio/ano</th>
                  </tr>
                </thead>
                <tbody>
                  {opcoes.map((o, i) => {
                    const melhor = isMelhor(o, consolidado.melhorOpcao);
                    return (
                      <tr key={`${o.fonte}-${o.plano ?? ""}-${i}`} className={`border-b ${melhor ? "bg-primary/5" : ""}`}>
                        <td className="p-3">
                          {melhor && <Star className="mr-1 inline h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                          {o.plano ?? "Único"}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline">{o.seguradora}</Badge>
                        </td>
                        <td className="p-3 text-right font-semibold">{fmtPct(o.pctAluguelMes)}</td>
                        <td className="p-3 text-right">{fmtBRL(o.premioMensal)}</td>
                        <td className="p-3 text-right text-muted-foreground">{fmtBRL(o.premioAnual)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ) : allPending ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            <Clock className="h-4 w-4 shrink-0 animate-pulse" />
            Análises em andamento — SegurosJá e/ou Alpop ainda processando. Atualize em instantes.
          </div>
        ) : null}

        {(consolidado.divergencias ?? []).map((d, i) => (
          <p key={i} className="flex items-center gap-2 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {d}
          </p>
        ))}
        {(consolidado.pendencias ?? []).map((p, i) => (
          <p key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" /> {p}
          </p>
        ))}

        <p className="text-[11px] text-muted-foreground">
          ★ opção recomendada (menor prêmio entre fontes aprovadas). Dado sensível — não compartilhe em grupo.
        </p>
      </CardContent>
    </Card>
  );
}
