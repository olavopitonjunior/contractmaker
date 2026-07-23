"use client";

import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { proposalStatusView, initials } from "@/lib/proposals/status-view";
import { NovaPropostaDialog } from "./NovaPropostaDialog";
import { ProposalFilters, type ListFilters } from "./ProposalFilters";
import { ProposalRowActions, type ProposalPermissions } from "./ProposalRowActions";

export interface ProposalRow {
  id: string;
  title: string;
  status: string;
  instrument: string;
  validUntil: string | null;
  createdAt: string;
  sentAt: string | null;
  firstViewedAt: string | null;
  convertedDealId: string | null;
  responsible: { name: string; isNonUser: boolean; image: string | null };
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

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function prazo(validUntil: string | null): { label: string; tone: "" | "warn" | "danger" } {
  if (!validUntil) return { label: "—", tone: "" };
  const days = Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: "vencida", tone: "danger" };
  if (days === 0) return { label: "vence hoje", tone: "danger" };
  return { label: `${days}d`, tone: days <= 2 ? "warn" : "" };
}

export function ProposalsListClient({
  proposals,
  tipo,
  showTabs,
  members,
  permissions,
  filters,
}: {
  proposals: ProposalRow[];
  tipo: "venda" | "locacao";
  showTabs: boolean;
  members: { id: string; name: string }[];
  permissions: ProposalPermissions;
  filters: ListFilters;
}) {
  const emAberto = proposals.filter((p) => OPEN_STATUSES.has(p.status)).length;
  const convertidas = proposals.filter((p) => p.status === "convertida").length;
  const expirando = proposals.filter(
    (p) => OPEN_STATUSES.has(p.status) && prazo(p.validUntil).tone !== ""
  ).length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Propostas</h1>
          <p className="text-sm text-muted-foreground">
            Ofertas antes do negócio — envie, acompanhe a assinatura e converta em um clique.
          </p>
        </div>
        <NovaPropostaDialog tipo={tipo} />
      </div>

      <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
        <Kpi label="Em aberto" value={emAberto} />
        <Kpi label="Convertidas" value={convertidas} tone="success" />
        <Kpi label="Expirando" value={expirando} tone={expirando > 0 ? "warn" : undefined} />
      </div>

      <ProposalFilters tipo={tipo} showTabs={showTabs} members={members} filters={filters} />

      {proposals.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <p className="font-medium text-foreground">Nenhuma proposta por aqui</p>
          <p className="mt-1 text-sm">
            Ajuste os filtros ou crie a primeira proposta e mande pro cliente assinar por e-mail ou
            WhatsApp. Quando ele aceitar, vira negócio automaticamente.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proponente</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="text-right">{tipo === "venda" ? "Valor" : "Aluguel"}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => {
                  const sv = proposalStatusView(p.status);
                  const pz = prazo(p.validUntil);
                  return (
                    <TableRow key={p.id} className="group">
                      <TableCell className="max-w-[280px]">
                        <Link
                          href={`/pipeline/propostas/${p.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.title}
                        </Link>
                        {p.resumo.imovel && (
                          <div className="truncate text-xs text-muted-foreground">
                            {p.resumo.imovel}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            {p.responsible.image && <AvatarImage src={p.responsible.image} />}
                            <AvatarFallback className="text-[10px]">
                              {initials(p.responsible.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{p.responsible.name}</span>
                          {p.responsible.isNonUser && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              externo
                            </Badge>
                          )}
                        </div>
                      </TableCell>
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
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {p.sentAt ? `enviada ${shortDate(p.sentAt)}` : `criada ${shortDate(p.createdAt)}`}
                          {p.firstViewedAt ? ` · vista ${shortDate(p.firstViewedAt)}` : ""}
                        </div>
                      </TableCell>
                      <TableCell
                        className={
                          pz.tone === "danger"
                            ? "text-destructive font-medium"
                            : pz.tone === "warn"
                              ? "text-warning font-medium"
                              : "text-muted-foreground"
                        }
                      >
                        {pz.label}
                      </TableCell>
                      <TableCell>
                        <ProposalRowActions
                          proposal={{
                            id: p.id,
                            status: p.status,
                            instrument: p.instrument,
                            convertedDealId: p.convertedDealId,
                          }}
                          permissions={permissions}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warn";
}) {
  const color =
    tone === "success" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <Card className="p-3">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}
