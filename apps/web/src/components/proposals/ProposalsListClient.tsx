"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { proposalStatusView, initials } from "@/lib/proposals/status-view";
import { LIVE_POLL_STATUSES } from "@/lib/proposals/status-sets";
import { ROUND_LABELS, type ProposalRound } from "@/lib/proposals/round-view";
import { Button } from "@/components/ui/button";
import { Plus, Mail, MessageCircle, Smartphone } from "lucide-react";
import type { SendChannelView } from "@/lib/proposals/send-channel";
import { ProposalFilters, type ListFilters } from "./ProposalFilters";
import { ProposalRowActions, type ProposalPermissions } from "./ProposalRowActions";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { NO_PERMISSION_HINT } from "@/lib/security/rbac/ui";

/**
 * Datas, prazo e valor chegam FORMATADOS do server component
 * (`.../pipeline/propostas/page.tsx`). Não formatar aqui: `toLocale*` depende do
 * padrão de locale do ICU do runtime (o do Node da Vercel ≠ o do browser) e o
 * prazo depende de `Date.now()` (muda entre SSR e hidratação) — os dois viram
 * hydration mismatch (React #418/#423). Ver lib/format/datetime.ts.
 */
export interface ProposalRow {
  id: string;
  /** "PROP-2026-0042". Null só em proposta anterior ao backfill. */
  code: string | null;
  title: string;
  status: string;
  kind: string;
  instrument: string;
  /** Canal de envio já resolvido no servidor (ver lib/proposals/send-channel.ts). */
  sendChannel: SendChannelView;
  /** "28/07". */
  createdAtLabel: string;
  /** "28/07" ou "" quando não enviada. */
  sentAtLabel: string;
  /** `sentAt` CRU (ISO) — o rótulo acima é formatado e não serve de
   *  discriminador. Ver `isFalhaEnvioAlreadyDelivered` (pergunta da EXCLUSÃO). */
  sentAt: string | null;
  /** "28/07" ou "" quando nunca vista. */
  firstViewedAtLabel: string;
  prazo: { label: string; tone: "none" | "warn" | "danger" };
  convertedDealId: string | null;
  responsible: { name: string; isNonUser: boolean; image: string | null };
  resumo: {
    proponente: string | null;
    imovel: string | null;
    valorLabel: string | null;
    /** Chip de negócio: venda = modalidade; locação = garantia + prazo. */
    negocio: string | null;
  };
  /** Rodada do fluxo em duas vias (round-view) — resolvida no servidor. */
  round: ProposalRound;
}

export function ProposalsListClient({
  proposals,
  tipo,
  showTabs,
  members,
  permissions,
  filters,
  kpis,
}: {
  proposals: ProposalRow[];
  tipo: "venda" | "locacao";
  showTabs: boolean;
  members: { id: string; name: string }[];
  permissions: ProposalPermissions;
  filters: ListFilters;
  /** Totais da ORG (independentes dos filtros da tabela) — evita KPI subcontado. */
  kpis: { open: number; converted: number; expiring: number; awaitingDecision: number };
}) {
  const router = useRouter();
  // Gating de CTA (feature Gerente) — libera enquanto carrega pra não piscar.
  // A página `/pipeline/propostas/nova` já barra no servidor (redirect); aqui é
  // só não oferecer o caminho a quem não pode criar.
  const perms = usePermissions();
  const canCreateProposal =
    perms.loading || perms.can(PERMISSION.PROPOSAL_CREATE);

  // Tempo real leve: enquanto houver proposta com evento EXTERNO possível
  // (assinatura em curso), dá refresh no server component a cada 10s (o webhook
  // já atualizou o DB). A parada de decisão fica fora — é o corretor que age,
  // e mantê-la aqui deixava a lista pollando por dias (bug B).
  const hasOpen = proposals.some((p) => LIVE_POLL_STATUSES.has(p.status));
  useEffect(() => {
    if (!hasOpen) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [hasOpen, router]);

  // Totais da ORG (do servidor), NÃO do array filtrado/capado — senão filtrar a
  // tabela pra "Concluídas" zerava "Em aberto" e o take:200 subcontava.
  const {
    open: emAberto,
    converted: convertidas,
    expiring: expirando,
    awaitingDecision: aguardandoDecisao,
  } = kpis;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Propostas</h1>
          <p className="text-sm text-muted-foreground">
            Ofertas antes do negócio — envie, acompanhe a assinatura e converta em um clique.
          </p>
        </div>
        {/* <Link>, não onClick: a criação virou PÁGINA justamente pra poder ser
            aberta em nova guia (ctrl/cmd+clique) e sobreviver a um clique fora.
            Sem permissão vira botão desabilitado — `disabled` num <a> não
            desabilita nada, então o Link some junto. */}
        {canCreateProposal ? (
          <Button size="sm" asChild>
            <Link href={`/pipeline/propostas/nova?tipo=${tipo}`}>
              <Plus className="mr-1 h-4 w-4" /> Nova proposta
            </Link>
          </Button>
        ) : (
          <Button size="sm" disabled title={NO_PERMISSION_HINT}>
            <Plus className="mr-1 h-4 w-4" /> Nova proposta
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:max-w-3xl">
        <Kpi label="Em aberto" value={emAberto} />
        <Kpi
          label="Aguardando decisão"
          value={aguardandoDecisao}
          tone={aguardandoDecisao > 0 ? "warn" : undefined}
        />
        <Kpi label="Assinadas/Convertidas" value={convertidas} tone="success" />
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
                  <TableHead>Proposta</TableHead>
                  <TableHead>Proponente</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>{tipo === "venda" ? "Negócio" : "Condições"}</TableHead>
                  <TableHead className="text-right">{tipo === "venda" ? "Valor" : "Aluguel"}</TableHead>
                  <TableHead>Envio</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => {
                  const sv = proposalStatusView(p.status);
                  const pz = p.prazo;
                  return (
                    <TableRow key={p.id} className="group">
                      {/* `max-w` em <td> não clampa (CSS 2.1 §10.4) e o TableCell
                          do registry tem whitespace-nowrap — sem um wrapper block
                          com truncate o título vaza por cima das colunas vizinhas. */}
                      <TableCell className="max-w-[260px] overflow-hidden">
                        <Link
                          href={`/pipeline/propostas/${p.id}`}
                          className="block max-w-full truncate font-medium hover:underline"
                          title={p.title}
                        >
                          {p.title}
                        </Link>
                        {p.code && (
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {p.code}
                          </div>
                        )}
                      </TableCell>
                      {/* Proponente saiu de baixo do título: com título livre os
                          dois deixaram de ser a mesma informação. */}
                      <TableCell className="max-w-[220px] overflow-hidden">
                        {p.resumo.proponente ? (
                          <span
                            className="block max-w-full truncate"
                            title={p.resumo.proponente}
                          >
                            {p.resumo.proponente}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {p.resumo.imovel && (
                          <div className="truncate text-xs text-muted-foreground" title={p.resumo.imovel}>
                            {p.resumo.imovel}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar data-size="sm">
                            {p.responsible.image && <AvatarImage src={p.responsible.image} />}
                            <AvatarFallback className="text-[10px]">
                              {initials(p.responsible.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="max-w-[10rem] truncate text-sm">{p.responsible.name}</span>
                          {p.responsible.isNonUser && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              externo
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.resumo.negocio ? (
                          <Badge variant="outline" className="font-normal text-muted-foreground">
                            {p.resumo.negocio}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.resumo.valorLabel ?? "—"}
                        {tipo === "locacao" && p.resumo.valorLabel != null && (
                          <span className="text-xs text-muted-foreground">/mês</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <SendChannelCell channel={p.sendChannel} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={sv.className}>
                          {sv.label}
                        </Badge>
                        {(p.round === "segunda_via_falhou" || p.round === "segunda_via_enviada") && (
                          <div
                            className={
                              p.round === "segunda_via_falhou"
                                ? "mt-0.5 text-[11px] font-medium text-destructive"
                                : "mt-0.5 text-[11px] text-muted-foreground"
                            }
                          >
                            {ROUND_LABELS[p.round]}
                          </div>
                        )}
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {p.sentAtLabel
                            ? `enviada ${p.sentAtLabel}`
                            : `criada ${p.createdAtLabel}`}
                          {p.firstViewedAtLabel ? ` · vista ${p.firstViewedAtLabel}` : ""}
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
                            kind: p.kind,
                            instrument: p.instrument,
                            convertedDealId: p.convertedDealId,
                            title: p.title,
                            sentAt: p.sentAt,
                          }}
                          permissions={permissions}
                          members={members}
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

/**
 * Canal de envio. `resolved: false` = ainda é só o plano (proposta não enviada)
 * — fica esmaecido, senão a lista afirma um canal que ninguém usou ainda. O
 * `title` explica a diferença sem gastar espaço na célula.
 */
function SendChannelCell({ channel }: { channel: SendChannelView }) {
  if (channel.key === "nenhum") {
    return <span className="text-muted-foreground">—</span>;
  }
  const Icon =
    channel.key === "whatsapp"
      ? MessageCircle
      : channel.key === "sms"
        ? Smartphone
        : channel.key === "misto"
          ? MessageCircle
          : Mail;
  return (
    <span
      className={`flex items-center gap-1.5 text-sm ${
        channel.resolved ? "" : "text-muted-foreground"
      }`}
      title={channel.resolved ? "Canal usado no envio" : "Canal previsto — ainda não enviada"}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{channel.label}</span>
    </span>
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
