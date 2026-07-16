"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { proposalStatusView } from "@/lib/proposals/status-view";
import { useProposalPolling } from "@/hooks/useProposalPolling";

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
  validUntil: string | null;
  createdAt: string;
  dossierUrl: string | null;
  resumo: { proponente: string | null; imovel: string | null; valor: number | null };
}

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ProposalDetailClient({
  proposal,
  signers,
  events,
  attachments,
}: {
  proposal: Proposal;
  signers: { id: string; name: string; role: string; channel: string; status: string }[];
  events: { id: string; eventName: string; receivedAt: string }[];
  attachments: { id: string; filename: string; category: string | null; url: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Tempo real: pulla o status enquanto a proposta está viva e dá refresh no
  // server component quando o status muda (webhook → DB → aqui em ~3.5s).
  const isLive = !["convertida", "cancelada", "expirada", "recusada_proponente", "rascunho"].includes(
    proposal.status
  );
  const { data: live } = useProposalPolling(proposal.id, {
    enabled: isLive,
    onStatusChange: () => router.refresh(),
  });
  const liveStatus = live?.status ?? proposal.status;
  const sv = proposalStatusView(liveStatus);

  const canSend = ["rascunho", "falha_envio"].includes(proposal.status);
  const canConvert = ["completa", "assinada_proponente", "aguardando_vendedor"].includes(
    proposal.status
  );
  const canConvertUnsigned = ["enviada", "entregue", "visualizada", "rascunho"].includes(
    proposal.status
  );

  async function send() {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/send`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.error === "preflight" && Array.isArray(d.issues)) {
          throw new Error(
            "Corrija antes de enviar: " + d.issues.map((i: { reason: string }) => i.reason).join(" · ")
          );
        }
        throw new Error(d.error === "budget" ? "Orçamento de assinaturas excedido." : d.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        d.instrument === "aceite" ? "Enviado por Aceite via WhatsApp" : "Enviado para assinatura"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setBusy(false);
    }
  }

  const canCancel = ![
    "convertida",
    "cancelada",
    "expirada",
    "recusada_proponente",
    "recusada_vendedor",
    "completa",
  ].includes(liveStatus);

  async function cancelProposal() {
    if (!window.confirm("Cancelar esta proposta? Os envelopes na ClickSign serão cancelados.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/cancel`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success("Proposta cancelada");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar");
    } finally {
      setBusy(false);
    }
  }

  async function signerAction(
    signerId: string,
    kind: "resend" | "remove" | "edit"
  ) {
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

  async function convert(allowUnsigned: boolean) {
    if (allowUnsigned) {
      const reason = window.prompt(
        "Converter sem assinatura. Qual o motivo? (fica no histórico)"
      );
      if (!reason?.trim()) return;
      await doConvert({ allowUnsigned: true, unsignedReason: reason });
    } else {
      await doConvert({});
    }
  }

  async function doConvert(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success("Proposta convertida em negócio");
      if (d.dealId) router.push(`/deals/${d.dealId}`);
      else router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao converter");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/pipeline/propostas"
            className="text-sm text-muted-foreground hover:underline inline-flex items-center"
          >
            <ChevronLeft className="h-4 w-4" /> Propostas
          </Link>
          <h1 className="text-xl font-semibold mt-1">{proposal.title}</h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            <Badge variant="outline" className={sv.className}>
              {sv.label}
            </Badge>
            <span>· {proposal.kind === "venda" ? "Venda" : "Locação"}</span>
            <span>· criada {fmt(proposal.createdAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {canSend && (
            <Button onClick={send} disabled={busy}>
              Enviar para assinatura
            </Button>
          )}
          {canConvert && (
            <Button onClick={() => convert(false)} disabled={busy}>
              Converter em negócio
            </Button>
          )}
          {!canConvert && canConvertUnsigned && (
            <Button variant="outline" onClick={() => convert(true)} disabled={busy}>
              Converter sem assinatura
            </Button>
          )}
          {canCancel && (
            <Button variant="ghost" className="text-red-600" onClick={cancelProposal} disabled={busy}>
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Resumo</h2>
          <Row label="Proponente" value={proposal.resumo.proponente ?? "—"} />
          <Row label="Imóvel" value={proposal.resumo.imovel ?? "—"} />
          <Row label="Valor" value={money(proposal.resumo.valor)} />
          <Row
            label="Validade"
            value={proposal.validUntil ? fmt(proposal.validUntil) : "—"}
          />
          {proposal.dossierUrl && (
            <a
              href={proposal.dossierUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
            >
              <FileText className="h-4 w-4" /> Documento final (PDF)
            </a>
          )}
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Assinaturas</h2>
          {(() => {
            // Enviada: usa os EnvelopeSigner do polling (têm id + status → ações).
            // Antes do envio: usa os ProposalSigner (sem ações).
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
              <ul className="text-sm space-y-2">
                {rows.map((s) => {
                  const badge = s.status ? SIGNER_STATUS_LABEL[s.status] ?? s.status : null;
                  const badgeCls =
                    s.status === "signed"
                      ? "text-green-600"
                      : s.status === "refused" || s.status === "email_failed"
                        ? "text-red-600"
                        : s.status === "viewed"
                          ? "text-blue-600"
                          : "text-muted-foreground";
                  const actionable = s.sent && !["signed", "removed"].includes(s.status);
                  return (
                    <li key={s.id} className="space-y-1">
                      <div className="flex justify-between gap-2">
                        <span>
                          {s.name} <span className="text-muted-foreground">· {s.role}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">{s.channel}</span>
                          {badge && <span className={badgeCls}>· {badge}</span>}
                        </span>
                      </div>
                      {actionable && (
                        <div className="flex gap-3 text-xs">
                          <button className="text-primary hover:underline" onClick={() => signerAction(s.id, "resend")} disabled={busy}>
                            Reenviar
                          </button>
                          <button className="text-primary hover:underline" onClick={() => signerAction(s.id, "edit")} disabled={busy}>
                            Editar contato
                          </button>
                          <button className="text-red-600 hover:underline" onClick={() => signerAction(s.id, "remove")} disabled={busy}>
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

      {attachments.length > 0 && (
        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Documentos</h2>
          <ul className="text-sm space-y-1">
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

      <Card className="p-4 space-y-1">
        <h2 className="font-medium">Histórico</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos ainda.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {events.map((e) => (
              <li key={e.id} className="flex justify-between">
                <span>{e.eventName}</span>
                <span className="text-muted-foreground">{fmt(e.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
