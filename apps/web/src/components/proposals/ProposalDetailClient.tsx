"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, FileText, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { proposalStatusView, proposalEventLabel } from "@/lib/proposals/status-view";
import { EDITABLE_STATUSES } from "@/lib/proposals/status-sets";
import { useProposalPolling } from "@/hooks/useProposalPolling";
import { ProposalProgressTimeline } from "./ProposalProgressTimeline";
import { ProposalAssigneeControl } from "./ProposalAssigneeControl";
import { ProposalActionBar } from "./ProposalActionBar";
import { ProposalDocumentCard } from "./ProposalDocumentCard";
import type { ProposalPermissions } from "./ProposalRowActions";

// Rótulo/cor por signatário. Duas fontes de vocabulário DISJUNTAS:
//  - EnvelopeSigner.status (polling/envelope): pending/notified/viewed/signed/
//    refused/email_failed/removed
//  - ProposalSigner.acceptanceStatus (Aceite/WhatsApp, sem envelope): completed/
//    sent/expired/canceled (+ refused, que coincide)
// Ambos mapeados aqui pra o Aceite não renderizar o token cru em inglês.
const SIGNER_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  notified: "Notificado",
  viewed: "Visualizou",
  signed: "Assinou",
  refused: "Recusou",
  email_failed: "Falha no e-mail",
  removed: "Removido",
  // Vocabulário do Aceite (acceptanceStatus):
  completed: "Assinou",
  sent: "Aguardando",
  expired: "Expirou",
  canceled: "Cancelado",
};

/**
 * Tudo que dependeria de locale ou do relógio já chega FORMATADO do server
 * component (`.../propostas/[id]/page.tsx`): datas, prazo e valor são strings.
 *
 * Não voltar a formatar aqui. `toLocale*` resolve o padrão de data no ICU do
 * runtime, e o ICU do Node da Vercel não é o do browser do usuário — a mesma
 * data saía "28/07/2026 20:23" no HTML do servidor e "28/07/2026, 20:23" na
 * hidratação. E o prazo relativo ("faltam 5d") deriva de `Date.now()`, que muda
 * entre o SSR e a hidratação. Qualquer um dos dois é hydration mismatch: React
 * #418 e, quando escala, #423 (a raiz inteira re-renderiza no client e o card
 * "Documento" fica em branco). Ver lib/format/datetime.ts.
 */
interface Proposal {
  id: string;
  title: string;
  status: string;
  kind: string;
  instrument: string;
  createdAtLabel: string;
  sentAtLabel: string;
  deliveredAtLabel: string;
  firstViewedAtLabel: string;
  viewCount: number;
  lastReminderAtLabel: string;
  reminderCount: number;
  validUntilLabel: string;
  prazo: { label: string; danger: boolean };
  convertedDealId: string | null;
  dossierUrl: string | null;
  resumo: { proponente: string | null; imovel: string | null; valorLabel: string | null };
  responsible: { name: string; isNonUser: boolean; image: string | null };
  responsibleUserId: string | null;
  responsibleName: string | null;
}

export function ProposalDetailClient({
  proposal,
  signers,
  events,
  attachments,
  members,
  permissions,
  sentSnapshotHtml,
}: {
  proposal: Proposal;
  signers: { id: string; name: string; role: string; channel: string; status: string }[];
  events: { id: string; eventName: string; receivedAtLabel: string }[];
  attachments: { id: string; filename: string; category: string | null; url: string }[];
  members: { id: string; name: string }[];
  permissions: ProposalPermissions;
  /** Documento congelado no envio (null enquanto a proposta não saiu). */
  sentSnapshotHtml: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [contactEdit, setContactEdit] = useState<null | {
    signerId: string;
    name: string;
    email: string;
    phone: string;
  }>(null);

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
  const pz = proposal.prazo;
  // Derivado do status AO VIVO (não do prop do servidor): se a proposta for
  // enviada em outra aba, o botão de editar some junto com o preview — mesmo
  // conjunto que o PATCH e o /preview aceitam no servidor.
  const canEdit = EDITABLE_STATUSES.has(liveStatus);

  // Ações por-signatário (no EnvelopeSigner do envelope em curso). "contact" é
  // alimentada pelo diálogo abaixo — dois `window.prompt` em sequência não davam
  // contexto (qual
  // signatário?), não validavam nada e um Esc no 2º já tinha coletado o 1º.
  async function signerAction(
    signerId: string,
    kind: "resend" | "remove" | "contact",
    patchBody?: Record<string, string>
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
      if (!patchBody || Object.keys(patchBody).length === 0) return;
      body = JSON.stringify(patchBody);
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
        kind === "resend"
          ? "Notificação reenviada"
          : kind === "remove"
            ? "Signatário removido"
            : "Contato atualizado"
      );
      setContactEdit(null);
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit && (
            <Button variant="outline" asChild>
              <Link href={`/pipeline/propostas/${proposal.id}/editar`}>
                <Pencil className="mr-1.5 h-4 w-4" /> Editar proposta
              </Link>
            </Button>
          )}
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
          <Row label="Valor" value={proposal.resumo.valorLabel ?? "—"} />
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
          <Row label="Criada" value={proposal.createdAtLabel} />
          <Row label="Enviada" value={proposal.sentAtLabel} />
          <Row label="Entregue" value={proposal.deliveredAtLabel} />
          <Row
            label="Visualizada"
            value={
              proposal.viewCount > 1
                ? `${proposal.firstViewedAtLabel} (${proposal.viewCount}×)`
                : proposal.firstViewedAtLabel
            }
          />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Validade</span>
            <span className="font-medium">
              {proposal.validUntilLabel}{" "}
              <span className={pz.danger ? "text-destructive" : "text-muted-foreground"}>
                ({pz.label})
              </span>
            </span>
          </div>
          {proposal.reminderCount > 0 && (
            <Row
              label="Último lembrete"
              value={`${proposal.lastReminderAtLabel} (${proposal.reminderCount}×)`}
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
                : signers.map((s) => ({ id: s.id, name: s.name, role: s.role, channel: s.channel, status: s.status, sent: false }));
            if (rows.length === 0) {
              return <p className="text-sm text-muted-foreground">Nenhum signatário definido ainda.</p>;
            }
            return (
              <ul className="space-y-2 text-sm">
                {rows.map((s) => {
                  const badge = s.status ? SIGNER_STATUS_LABEL[s.status] ?? s.status : null;
                  const badgeCls =
                    s.status === "signed" || s.status === "completed"
                      ? "text-success"
                      : s.status === "refused" || s.status === "email_failed"
                        ? "text-destructive"
                        : s.status === "viewed"
                          ? "text-info"
                          : s.status === "sent"
                            ? "text-info"
                            : "text-muted-foreground";
                  // Só oferece Reenviar/Editar/Remover enquanto o desfecho está EM
                  // ABERTO. Exclui os terminais de ambos os vocabulários (envelope +
                  // aceite): assinou/recusou/expirou/cancelou/removido/falhou.
                  const actionable =
                    s.sent &&
                    ![
                      "signed",
                      "completed",
                      "removed",
                      "refused",
                      "expired",
                      "canceled",
                      "email_failed",
                    ].includes(s.status);
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
                          <button
                            className="text-primary hover:underline"
                            onClick={() =>
                              setContactEdit({
                                signerId: s.id,
                                name: s.name,
                                email: "",
                                phone: "",
                              })
                            }
                            disabled={busy}
                          >
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

      {/* Documento — preview antes do envio, snapshot congelado depois */}
      <ProposalDocumentCard
        proposalId={proposal.id}
        editable={canEdit}
        snapshotHtml={sentSnapshotHtml}
      />

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
                  <span className="text-xs text-muted-foreground">{e.receivedAtLabel}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* Editar contato do signatário */}
      <Dialog open={contactEdit != null} onOpenChange={(o) => !o && setContactEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar contato</DialogTitle>
            <DialogDescription>
              {contactEdit?.name} — preencha só o que quiser alterar. Campos em
              branco ficam como estão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="signer-email">E-mail</Label>
              <Input
                id="signer-email"
                type="email"
                value={contactEdit?.email ?? ""}
                onChange={(e) =>
                  setContactEdit((c) => (c ? { ...c, email: e.target.value } : c))
                }
                placeholder="novo@email.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="signer-phone">WhatsApp / telefone</Label>
              <Input
                id="signer-phone"
                inputMode="tel"
                value={contactEdit?.phone ?? ""}
                onChange={(e) =>
                  setContactEdit((c) => (c ? { ...c, phone: e.target.value } : c))
                }
                placeholder="(11) 98765-4321"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactEdit(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              disabled={
                busy ||
                !contactEdit ||
                (!contactEdit.email.trim() && !contactEdit.phone.trim())
              }
              onClick={() => {
                if (!contactEdit) return;
                const patch: Record<string, string> = {};
                if (contactEdit.email.trim()) patch.email = contactEdit.email.trim();
                if (contactEdit.phone.trim()) patch.phone = contactEdit.phone.trim();
                void signerAction(contactEdit.signerId, "contact", patch);
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
