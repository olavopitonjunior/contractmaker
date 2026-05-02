"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  FileSignature,
  RefreshCw,
  Send,
  Trash2,
  Download,
  Mail,
  AlertTriangle,
  Eye,
  UserMinus,
  Pencil,
} from "lucide-react";
import {
  useEnvelopePolling,
  type EnvelopeRow,
  type EnvelopeSignerRow,
} from "@/hooks/useEnvelopePolling";
import { SendEnvelopeDialog } from "./SendEnvelopeDialog";
import { EditEnvelopeDialog } from "./EditEnvelopeDialog";
import { EditSignerDialog } from "./EditSignerDialog";
import { cn } from "@/lib/utils";

interface PartyLite {
  nome?: string;
  razao_social?: string;
  email?: string;
}

interface ContractLite {
  id: string;
  version: number;
  status: string;
  templateName?: string | null;
}

interface SignaturesTabProps {
  contracts: ContractLite[];
  vendedores: PartyLite[];
  compradores: PartyLite[];
}

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
};

export function SignaturesTab({
  contracts,
  vendedores,
  compradores,
}: SignaturesTabProps) {
  const approved = contracts.filter((c) => c.status === "aprovado");

  if (approved.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <FileSignature className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="font-medium mb-1">Nenhum contrato aprovado</h3>
        <p className="text-sm text-muted-foreground">
          Aprove o contrato no editor para liberar o envio para assinatura.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {approved.map((c) => (
        <ContractEnvelopesSection
          key={c.id}
          contract={c}
          vendedores={vendedores}
          compradores={compradores}
        />
      ))}
    </div>
  );
}

function ContractEnvelopesSection({
  contract,
  vendedores,
  compradores,
}: {
  contract: ContractLite;
  vendedores: PartyLite[];
  compradores: PartyLite[];
}) {
  const { envelopes, loading, refetch } = useEnvelopePolling(contract.id);
  const [sendOpen, setSendOpen] = useState(false);

  const partes = useMemo(() => {
    return [
      ...vendedores.map((p, idx) => ({
        sourceKind: "vendedor" as const,
        sourceIndex: idx,
        name: (p.nome || p.razao_social || `Vendedor ${idx + 1}`).trim(),
        email: p.email?.trim() || null,
        hasEmail: Boolean(p.email?.trim()),
      })),
      ...compradores.map((p, idx) => ({
        sourceKind: "comprador" as const,
        sourceIndex: idx,
        name: (p.nome || p.razao_social || `Comprador ${idx + 1}`).trim(),
        email: p.email?.trim() || null,
        hasEmail: Boolean(p.email?.trim()),
      })),
    ];
  }, [vendedores, compradores]);

  const hasActiveOrClosed = envelopes.some(
    (e) => e.status === "running" || e.status === "closed"
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSignature className="h-4 w-4" />
            Contrato v{contract.version}
            {contract.templateName ? (
              <span className="text-sm font-normal text-muted-foreground">
                · {contract.templateName}
              </span>
            ) : null}
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={refetch}
            title="Atualizar"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={() => setSendOpen(true)}
            disabled={hasActiveOrClosed}
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {hasActiveOrClosed ? "Já enviado" : "Enviar para assinatura"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando envelopes...
          </div>
        ) : envelopes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não há envelopes enviados para este contrato.
          </p>
        ) : (
          envelopes.map((env) => (
            <EnvelopeCard
              key={env.id}
              envelope={env}
              contractId={contract.id}
              onChange={refetch}
            />
          ))
        )}
      </CardContent>

      <SendEnvelopeDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        contractId={contract.id}
        contractTitle={`Contrato v${contract.version}`}
        partes={partes}
        onSent={refetch}
      />
    </Card>
  );
}

function EnvelopeCard({
  envelope,
  contractId,
  onChange,
}: {
  envelope: EnvelopeRow;
  contractId: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const canEdit = envelope.status === "draft" || envelope.status === "running";

  const handleCancel = async () => {
    if (!confirm("Cancelar este envelope? Os signatários não conseguirão mais assinar."))
      return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/envelopes/${envelope.id}`,
        { method: "DELETE" }
      );
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
            <span>
              Enviado{" "}
              {new Date(envelope.sentAt).toLocaleDateString("pt-BR")}
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
              contractId={contractId}
              onChange={onChange}
            />
          ))}
      </div>

      <div className="px-3 py-2 border-t flex items-center justify-end gap-2">
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
        contractId={contractId}
        envelope={envelope}
        onSaved={onChange}
      />
    </div>
  );
}

function SignerRow({
  signer,
  envelope,
  contractId,
  onChange,
}: {
  signer: EnvelopeSignerRow;
  envelope: EnvelopeRow;
  contractId: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const handleResend = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/envelopes/${envelope.id}/signers/${signer.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resend" }),
        }
      );
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
      const res = await fetch(
        `/api/contracts/${contractId}/envelopes/${envelope.id}/signers/${signer.id}`,
        { method: "DELETE" }
      );
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

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        {signerStatusIcon(signer.status)}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{signer.name}</span>
            <Badge variant="outline" className="text-xs h-5 capitalize">
              {signer.sourceKind}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {signer.email}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "text-xs",
            signer.status === "signed" && "text-emerald-600",
            signer.status === "refused" && "text-destructive"
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
        contractId={contractId}
        envelopeId={envelope.id}
        signer={signer}
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
    case "pending":
    default:
      return <Clock className={cn(cls, "text-muted-foreground")} />;
  }
}
