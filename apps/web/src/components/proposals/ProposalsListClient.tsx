"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { proposalStatusView } from "@/lib/proposals/status-view";
import { NovaPropostaDialog } from "./NovaPropostaDialog";

export interface ProposalRow {
  id: string;
  title: string;
  status: string;
  validUntil: string | null;
  createdAt: string;
  corretor: string | null;
  resumo: { imovel: string | null; valor: number | null };
}

const OPEN_STATUSES = new Set([
  "enviada",
  "entregue",
  "visualizada",
  "assinada_proponente",
  "aguardando_vendedor",
]);

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function prazo(validUntil: string | null): { label: string; warn: boolean } {
  if (!validUntil) return { label: "—", warn: false };
  const days = Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: "vencida", warn: true };
  if (days === 0) return { label: "vence hoje", warn: true };
  return { label: `${days}d`, warn: days <= 2 };
}

export function ProposalsListClient({
  proposals,
  tipo,
  showTabs,
}: {
  proposals: ProposalRow[];
  tipo: "venda" | "locacao";
  showTabs: boolean;
}) {
  const router = useRouter();

  // Tempo real leve na lista: enquanto houver proposta em aberto, dá refresh no
  // server component a cada 10s (o webhook já atualizou o DB). Sem polling
  // por-proposta — o gestor vê os status andarem sem recarregar a página.
  const hasOpen = proposals.some((p) => OPEN_STATUSES.has(p.status));
  useEffect(() => {
    if (!hasOpen) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [hasOpen, router]);

  const emAberto = proposals.filter((p) => OPEN_STATUSES.has(p.status)).length;
  const expirando = proposals.filter((p) => {
    const pz = prazo(p.validUntil);
    return pz.warn && OPEN_STATUSES.has(p.status);
  }).length;
  const convertidas = proposals.filter((p) => p.status === "convertida").length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Propostas</h1>
          {showTabs && (
            <div className="inline-flex rounded-md border p-0.5 text-sm">
              {(["venda", "locacao"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => router.push(`/pipeline/propostas?tipo=${t}`)}
                  className={`px-3 py-1 rounded ${
                    tipo === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t === "venda" ? "Vendas" : "Locação"}
                </button>
              ))}
            </div>
          )}
        </div>
        <NovaPropostaDialog tipo={tipo} />
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-xl">
        <Kpi label="Em aberto" value={emAberto} />
        <Kpi label="Convertidas" value={convertidas} />
        <Kpi label="Expirando" value={expirando} warn={expirando > 0} />
      </div>

      {proposals.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <p className="font-medium text-foreground">Nenhuma proposta ainda</p>
          <p className="mt-1 text-sm">
            Crie a primeira proposta e mande pro cliente assinar por e-mail ou WhatsApp.
            Quando ele aceitar, vira negócio automaticamente.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proponente</TableHead>
                <TableHead>Imóvel</TableHead>
                <TableHead className="text-right">
                  {tipo === "venda" ? "Valor" : "Aluguel"}
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prazo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals.map((p) => {
                const sv = proposalStatusView(p.status);
                const pz = prazo(p.validUntil);
                return (
                  <TableRow key={p.id} className="cursor-pointer">
                    <TableCell>
                      <Link href={`/pipeline/propostas/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                      {p.corretor && (
                        <div className="text-xs text-muted-foreground">{p.corretor}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{p.resumo.imovel ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(p.resumo.valor)}
                      {tipo === "locacao" && p.resumo.valor != null && (
                        <span className="text-xs text-muted-foreground">/mês</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={sv.className}>
                        {sv.label}
                      </Badge>
                    </TableCell>
                    <TableCell className={pz.warn ? "text-amber-600 font-medium" : ""}>
                      {pz.label}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card className="p-3">
      <div className={`text-2xl font-semibold ${warn ? "text-amber-600" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}
