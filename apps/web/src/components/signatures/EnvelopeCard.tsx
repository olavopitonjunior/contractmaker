"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Download,
  Mail,
  AlertTriangle,
  Eye,
  UserMinus,
  Pencil,
  UserPlus,
} from "lucide-react";
import type { EnvelopeRow, EnvelopeSignerRow } from "@/hooks/useEnvelopePolling";
import { EditEnvelopeDialog } from "@/components/pipeline/EditEnvelopeDialog";
import { EditSignerDialog } from "@/components/pipeline/EditSignerDialog";
import { AddSignerDialog } from "@/components/pipeline/AddSignerDialog";
import { clicksignRoleLabel } from "@/lib/clicksign/roles";
import { cn } from "@/lib/utils";

/**
 * Cartao de UM envelope ClickSign, com as acoes por envelope e por signatario.
 *
 * Mora fora de `pipeline/` porque serve TRES assuntos: contrato, anexo avulso e
 * proposta. O unico acoplamento e o `basePath` — todas as chamadas sao relativas
 * a ele (`DELETE {base}`, `PATCH {base}/signers/{id}`...), entao cada familia de
 * rota que implemente esse contrato reusa a UI inteira.
 */

const STATUS_LABEL: Record<EnvelopeRow["status"], string> = {
  draft: "Rascunho",
  running: "Em andamento",
  closed: "Concluído",
  canceled: "Cancelado",
  failed: "Falhou",
};

const STATUS_VARIANT: Record<
  EnvelopeRow["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  running: "secondary",
  closed: "default",
  canceled: "outline",
  failed: "destructive",
};

const SIGNER_STATUS_LABEL: Record<EnvelopeSignerRow["status"], string> = {
  pending: "Aguardando envio",
  notified: "Notificado",
  viewed: "Visualizou",
  signed: "Assinado",
  refused: "Recusou",
  removed: "Removido",
  email_failed: "E-mail não entregue",
};

export function EnvelopeCard({
  envelope,
  basePath,
  onChange,
}: {
  envelope: EnvelopeRow;
  /** Base do envelope: `/api/contracts/{id}/envelopes/{eid}` ou
   *  `/api/deals/{dealId}/envelopes/{eid}`. */
  basePath: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Em `running` os requirements do novo signatário vão via bulk_requirements
  // (único caminho pós-ativação) e ele é notificado na hora — quem já assinou
  // não é afetado. Editar e adicionar seguem a MESMA regra de status.
  const canEdit = envelope.status === "draft" || envelope.status === "running";
  const canAddSigner = canEdit;

  const handleCancel = async () => {
    if (!confirm("Cancelar este envelope? Os signatários não conseguirão mais assinar."))
      return;
    setBusy(true);
    try {
      const res = await fetch(basePath, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success("Envelope cancelado");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar");
    } finally {
      setBusy(false);
    }
  };

  const signedCount = envelope.signers.filter(
    (s) => s.status === "signed"
  ).length;
  const totalActive = envelope.signers.filter((s) => s.status !== "removed").length;

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={STATUS_VARIANT[envelope.status]}>
            {STATUS_LABEL[envelope.status]}
          </Badge>
          <span className="text-sm font-medium truncate">{envelope.name}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          {envelope.sentAt && (
            <span title={new Date(envelope.sentAt).toLocaleString("pt-BR")}>
              Enviado em{" "}
              {new Date(envelope.sentAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {envelope.closedAt && (
            <span title={new Date(envelope.closedAt).toLocaleString("pt-BR")}>
              Concluído em{" "}
              {new Date(envelope.closedAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <span>
            {signedCount}/{totalActive} assinaturas
          </span>
          <span>R$ {(envelope.costCents / 100).toFixed(2)}</span>
        </div>
      </div>

      {envelope.lastError && envelope.status === "failed" && (
        <div className="px-3 py-2 bg-destructive/10 border-b text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="break-words">{envelope.lastError}</span>
        </div>
      )}

      <div className="divide-y">
        {envelope.signers
          .filter((s) => s.status !== "removed")
          .map((signer) => (
            <SignerRow
              key={signer.id}
              signer={signer}
              envelope={envelope}
              basePath={basePath}
              onChange={onChange}
            />
          ))}
      </div>

      <div className="px-3 py-2 border-t flex items-center justify-end gap-2">
        {canAddSigner && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setAddOpen(true)}
            disabled={busy}
          >
            <UserPlus className="h-3 w-3 mr-1" />
            Adicionar assinante
          </Button>
        )}
        {envelope.signedDocumentUrl && (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-7 text-xs"
          >
            <a
              href={envelope.signedDocumentUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="h-3 w-3 mr-1" />
              PDF assinado
            </a>
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setEditOpen(true)}
            disabled={busy}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Editar
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={handleCancel}
            disabled={busy}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Cancelar envelope
          </Button>
        )}
      </div>

      <EditEnvelopeDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        basePath={basePath}
        envelope={envelope}
        onSaved={onChange}
      />
      <AddSignerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        basePath={basePath}
        onAdded={onChange}
        envelopeStatus={envelope.status}
      />
    </div>
  );
}

function SignerRow({
  signer,
  envelope,
  basePath,
  onChange,
}: {
  signer: EnvelopeSignerRow;
  envelope: EnvelopeRow;
  basePath: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const handleResend = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/signers/${signer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success("Notificação reenviada");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reenviar");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm(`Remover ${signer.name} deste envelope?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/signers/${signer.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success("Signatário removido");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    } finally {
      setBusy(false);
    }
  };

  const canResend =
    envelope.status === "running" &&
    signer.status !== "signed" &&
    signer.status !== "refused";
  const canEdit =
    (envelope.status === "draft" || envelope.status === "running") &&
    signer.status !== "signed" &&
    signer.status !== "removed";
  const canRemove =
    (envelope.status === "draft" || envelope.status === "running") &&
    signer.status !== "signed";

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const timeline = [
    signer.notifiedAt ? `Notificado em ${fmt(signer.notifiedAt)}` : null,
    signer.viewedAt ? `Abriu em ${fmt(signer.viewedAt)}` : null,
    signer.signedAt ? `Assinou em ${fmt(signer.signedAt)}` : null,
    signer.refusedAt ? `Recusou em ${fmt(signer.refusedAt)}` : null,
  ].filter(Boolean);

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        {signerStatusIcon(signer.status)}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {signer.signingGroup != null && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {signer.signingGroup}º
              </Badge>
            )}
            <span className="font-medium truncate">{signer.name}</span>
            <Badge variant="outline" className="text-xs h-5">
              {clicksignRoleLabel(signer.role) ?? signer.sourceKind}
            </Badge>
          </div>
          {/* Signatário de proposta pode não ter e-mail (proprietário vindo do
              cadastro, notificado por WhatsApp). Cair pro telefone em vez de
              renderizar `null` — que virava uma linha vazia sem contato nenhum. */}
          <div className="text-xs text-muted-foreground truncate">
            {signer.email || signer.phone || "sem contato"}
          </div>
          {signer.status === "email_failed" && (
            <div className="text-[11px] text-destructive mt-0.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>
                E-mail não entregue (endereço inválido). Corrija o endereço e
                reenvie.
              </span>
            </div>
          )}
          {timeline.length > 0 && (
            <div className="text-[11px] text-muted-foreground/80 mt-0.5">
              {timeline.join(" · ")}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "text-xs",
            signer.status === "signed" && "text-emerald-600",
            (signer.status === "refused" ||
              signer.status === "email_failed") &&
              "text-destructive"
          )}
        >
          {SIGNER_STATUS_LABEL[signer.status]}
        </span>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setEditOpen(true)}
            disabled={busy}
            title="Editar signatário"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        {canResend && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={handleResend}
            disabled={busy}
            title="Reenviar notificação"
          >
            <Mail className="h-3 w-3" />
          </Button>
        )}
        {canRemove && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={handleRemove}
            disabled={busy}
            title="Remover signatário"
          >
            <UserMinus className="h-3 w-3" />
          </Button>
        )}
      </div>

      <EditSignerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        basePath={basePath}
        signer={signer}
        envelopeStatus={envelope.status}
        onSaved={onChange}
      />
    </div>
  );
}

function signerStatusIcon(status: EnvelopeSignerRow["status"]) {
  const cls = "h-4 w-4";
  switch (status) {
    case "signed":
      return <CheckCircle2 className={cn(cls, "text-emerald-600")} />;
    case "refused":
      return <XCircle className={cn(cls, "text-destructive")} />;
    case "viewed":
      return <Eye className={cn(cls, "text-blue-600")} />;
    case "notified":
      return <Mail className={cn(cls, "text-amber-600")} />;
    case "removed":
      return <UserMinus className={cn(cls, "text-muted-foreground")} />;
    case "email_failed":
      return <AlertTriangle className={cn(cls, "text-destructive")} />;
    case "pending":
    default:
      return <Clock className={cn(cls, "text-muted-foreground")} />;
  }
}
