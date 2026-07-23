"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { proposalStatusView, proposalEventLabel } from "@/lib/proposals/status-view";
import { useProposalPolling } from "@/hooks/useProposalPolling";
import { ProposalProgressTimeline } from "./ProposalProgressTimeline";
import { ProposalAssigneeControl } from "./ProposalAssigneeControl";
import { ProposalActionBar } from "./ProposalActionBar";
import type { ProposalPermissions } from "./ProposalRowActions";

// Rótulo/cor do EnvelopeSigner.status (vindo do polling — sign/view real).
const SIGNER_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  notified: "Notificado",
  viewed: "Visualizou",
  signed: "Assinou",
  refused: "Recusou",
  email_failed: "Falha no e-mail",
  removed: "Removido",
};

interface Proposal {
  id: string;
  title: string;
  status: string;
  kind: string;
  instrument: string;
  validUntil: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  firstViewedAt: string | null;
  viewCount: number;
  lastReminderAt: string | null;
  reminderCount: number;
  completedAt: string | null;
  convertedAt: string | null;
  convertedDealId: string | null;
  dossierUrl: string | null;
  resumo: { proponente: string | null; imovel: string | null; valor: number | null };
  responsible: { name: string; isNonUser: boolean; image: string | null };
  responsibleUserId: string | null;
  responsibleName: string | null;
}

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function prazoLabel(validUntil: string | null): { label: string; danger: boolean } {
  if (!validUntil) return { label: "sem prazo", danger: false };
  const days = Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: "vencida", danger: true };
  if (days === 0) return { label: "vence hoje", danger: true };
  return { label: `faltam ${days}d`, danger: days <= 2 };
}

export function ProposalDetailClient({
  proposal,
  signers,
  events,
  attachments,
  members,
  permissions,
}: {
  proposal: Proposal;
  signers: { id: string; name: string; role: string; channel: string }[];
  events: { id: string; eventName: string; receivedAt: string }[];
  attachments: { id: string; filename: string; category: string | null; url: string }[];
  members: { id: string; name: string }[];
  permissions: ProposalPermissions;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Tempo real: pulla o status enquanto a proposta está viva; refresh do server
  // component quando muda (webhook → DB → aqui em ~3.5s).
  const isLive = ![
    "convertida",
    "cancelada",
    "expirada",
    "recusada_proponente",
    "recusada_vendedor",
    "rascunho",
    "falha_envio",
  ].includes(proposal.status);
  const { data: live } = useProposalPolling(proposal.id, {
    enabled: isLive,
    onStatusChange: () => router.refresh(),
  });
  const liveStatus = live?.status ?? proposal.status;
  const sv = proposalStatusView(liveStatus);
  const pz = prazoLabel(proposal.validUntil);

  // Ações por-signatário (no EnvelopeSigner do envelope em curso).
  async function signerAction(signerId: string, kind: "resend" | "remove" | "edit") {
    let url = `/api/proposals/${proposal.id}/signers/${signerId}`;
    let method = "PATCH";
    let body: string | undefined;
    if (kind === "resend") {
      url += "/resend";
      method = "POST";
    } else if (kind === "remove") {
      if (!window.confirm("Remover este signatário da proposta?")) return;
      method = "DELETE";
    } else {
      const email = window.prompt("Novo e-mail (deixe em branco pra não alterar):") ?? "";
      const phone = window.prompt("Novo WhatsApp/telefone (deixe em branco pra não alterar):") ?? "";
      const patch: Record<string, string> = {};
      if (email.trim()) patch.email = email.trim();
      if (phone.trim()) patch.phone = phone.trim();
      if (Object.keys(patch).length === 0) return;
      body = JSON.stringify(patch);
    }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success(
        kind === "resend" ? "Notificação reenviada" : kind === "remove" ? "Signatário removido" : "Contato atualizado"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na ação");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/pipeline/propostas"
            className="inline-flex items-center text-sm text-muted-foreground hover:underline"
          >
            <ChevronLeft className="h-4 w-4" /> Propostas
          </Link>
          <h1 className="font-display mt-1 truncate text-2xl font-semibold tracking-tight">
            {proposal.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className={`${sv.className} px-2.5 py-0.5`}>
              {sv.label}
            </Badge>
            <span className="text-muted-foreground">· {sv.turn}</span>
            <span className="text-muted-foreground">
              · {proposal.kind === "venda" ? "Venda" : "Locação"}
            </span>
          </div>
        </div>
        <ProposalActionBar
          proposal={{
            id: proposal.id,
            status: liveStatus,
            instrument: proposal.instrument,
            convertedDealId: proposal.convertedDealId,
          }}
          permissions={permissions}
        />
      </div>

      {/* Linha do tempo */}
      <Card className="p-4">
        <ProposalProgressTimeline status={liveStatus} />
      </Card>

      {/* Resumo + Responsável */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Resumo</h2>
          <Row label="Proponente" value={proposal.resumo.proponente ?? "—"} />
          <Row label="Imóvel" value={proposal.resumo.imovel ?? "—"} />
          <Row label="Valor" value={money(proposal.resumo.valor)} />
          <Row
            label="Instrumento"
            value={proposal.instrument === "aceite" ? "Aceite via WhatsApp" : "Assinatura (envelope)"}
          />
          {proposal.dossierUrl && (
            <a
              href={proposal.dossierUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <FileText className="h-4 w-4" /> Documento final (PDF)
            </a>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-medium">Responsável</h2>
          <ProposalAssigneeControl
            proposalId={proposal.id}
            responsible={proposal.responsible}
            responsibleUserId={proposal.responsibleUserId}
            members={members}
            canAssign={permissions.assign}
          />
        </Card>
      </div>

      {/* Datas + Assinaturas */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Datas</h2>
          <Row label="Criada" value={fmt(proposal.createdAt)} />
          <Row label="Enviada" value={fmt(proposal.sentAt)} />
          <Row label="Entregue" value={fmt(proposal.deliveredAt)} />
          <Row
            label="Visualizada"
            value={
              proposal.firstViewedAt
                ? `${fmt(proposal.firstViewedAt)}${proposal.viewCount > 1 ? ` (${proposal.viewCount}×)` : ""}`
                : "—"
            }
          />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Validade</span>
            <span className="font-medium">
              {fmt(proposal.validUntil)}{" "}
              <span className={pz.danger ? "text-destructive" : "text-muted-foreground"}>
                ({pz.label})
              </span>
            </span>
          </div>
          {proposal.reminderCount > 0 && (
            <Row
              label="Último lembrete"
              value={`${fmt(proposal.lastReminderAt)} (${proposal.reminderCount}×)`}
            />
          )}
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Assinaturas</h2>
          {(() => {
            // Enviada: EnvelopeSigner do polling (id + status → ações por-linha).
            // Antes do envio: ProposalSigner (sem ações).
            const rows =
              live && live.signers.length > 0
                ? live.signers
                    .filter((s) => s.status !== "removed")
                    .map((s) => ({ id: s.id, name: s.name, role: s.role ?? "", channel: s.channel, status: s.status, sent: true }))
                : signers.map((s) => ({ id: s.id, name: s.name, role: s.role, channel: s.channel, status: "", sent: false }));
            if (rows.length === 0) {
              return <p className="text-sm text-muted-foreground">Nenhum signatário definido ainda.</p>;
            }
            return (
              <ul className="space-y-2 text-sm">
                {rows.map((s) => {
                  const badge = s.status ? SIGNER_STATUS_LABEL[s.status] ?? s.status : null;
                  const badgeCls =
                    s.status === "signed"
                      ? "text-success"
                      : s.status === "refused" || s.status === "email_failed"
                        ? "text-destructive"
                        : s.status === "viewed"
                          ? "text-info"
                          : "text-muted-foreground";
                  const actionable = s.sent && !["signed", "removed"].includes(s.status);
                  return (
                    <li key={s.id} className="space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className="truncate">
                          {s.name} <span className="text-muted-foreground">· {s.role}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{s.channel}</span>
                          {badge && <span className={badgeCls}>· {badge}</span>}
                        </span>
                      </div>
                      {actionable && permissions.resend && (
                        <div className="flex gap-3 text-xs">
                          <button className="text-primary hover:underline" onClick={() => signerAction(s.id, "resend")} disabled={busy}>
                            Reenviar
                          </button>
                          <button className="text-primary hover:underline" onClick={() => signerAction(s.id, "edit")} disabled={busy}>
                            Editar contato
                          </button>
                          <button className="text-destructive hover:underline" onClick={() => signerAction(s.id, "remove")} disabled={busy}>
                            Remover
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </Card>
      </div>

      {/* Documentos */}
      {attachments.length > 0 && (
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Documentos</h2>
          <ul className="space-y-1 text-sm">
            {attachments.map((a) => (
              <li key={a.id}>
                <a href={a.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {a.filename}
                </a>
                {a.category && <span className="text-muted-foreground"> · {a.category}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Histórico — timeline vertical */}
      <Card className="p-4">
        <h2 className="mb-3 font-medium">Histórico</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos ainda.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-border pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm">{proposalEventLabel(e.eventName)}</span>
                  <span className="text-xs text-muted-foreground">{fmt(e.receivedAt)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}
