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
import { useDealEnvelopePolling } from "@/hooks/useDealEnvelopePolling";
import { SendEnvelopeDialog } from "./SendEnvelopeDialog";
import { SendAttachmentEnvelopeDialog } from "./SendAttachmentEnvelopeDialog";
import { EditEnvelopeDialog } from "./EditEnvelopeDialog";
import { EditSignerDialog } from "./EditSignerDialog";
import { cn } from "@/lib/utils";

interface PartyLite {
  tipo_pessoa?: string;
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
}

interface TestemunhaLite {
  nome?: string;
  cpf?: string;
  email?: string;
  incluir_como_signatario?: boolean;
}

interface CorretoraLite {
  corretora_tipo_pessoa?: string;
  imobiliaria_nome?: string;
  imobiliaria_cnpj?: string;
  imobiliaria_email?: string;
  creci?: string;
  incluir_como_signatario?: boolean;
}

interface ContractLite {
  id: string;
  version: number;
  status: string;
  templateName?: string | null;
}

interface AttachmentLite {
  id: string;
  filename: string;
  mime: string;
  category?: string | null;
}

interface SignaturesTabProps {
  contracts: ContractLite[];
  vendedores: PartyLite[];
  compradores: PartyLite[];
  /** Testemunhas vindas do form (mín 2). Se ausente, defaults vazios são
   *  criados na popup. */
  testemunhas?: TestemunhaLite[];
  /** Bloco de comissão. Quando ausente, popup mostra inputs vazios. */
  comissao?: CorretoraLite | null;
  /** Quando passado, habilita o fluxo de envelope avulso a partir de
   *  documentos da pasta. Pra retrocompat, é opcional. */
  dealId?: string;
  attachments?: AttachmentLite[];
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
  testemunhas = [],
  comissao = null,
  dealId,
  attachments = [],
}: SignaturesTabProps) {
  const approved = contracts.filter((c) => c.status === "aprovado");
  const pdfAttachments = attachments.filter((a) => a.mime === "application/pdf");

  // Permite envelope avulso quando temos dealId + ao menos 1 PDF na pasta.
  // Mostramos a seção mesmo sem PDFs pra explicar como liberar (placeholder).
  const showAttachmentSection = Boolean(dealId);

  if (approved.length === 0 && !showAttachmentSection) {
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
      {showAttachmentSection && dealId && (
        <AttachmentEnvelopesSection
          dealId={dealId}
          attachments={pdfAttachments}
          vendedores={vendedores}
          compradores={compradores}
        />
      )}
      {approved.map((c) => (
        <ContractEnvelopesSection
          key={c.id}
          contract={c}
          vendedores={vendedores}
          compradores={compradores}
          testemunhas={testemunhas}
          comissao={comissao}
        />
      ))}
      {approved.length === 0 && showAttachmentSection && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Quando você aprovar um contrato no editor, ele aparece aqui pra
          envio formal por modelo.
        </div>
      )}
    </div>
  );
}

function AttachmentEnvelopesSection({
  dealId,
  attachments,
  vendedores,
  compradores,
}: {
  dealId: string;
  attachments: AttachmentLite[];
  vendedores: PartyLite[];
  compradores: PartyLite[];
}) {
  const { envelopes, loading, refetch } = useDealEnvelopePolling(dealId);
  const [dialogOpen, setDialogOpen] = useState(false);

  const partySuggestions = useMemo(() => {
    return [
      ...vendedores.map((p, idx) => ({
        sourceKind: "vendedor" as const,
        sourceIndex: idx,
        name: (p.nome || p.razao_social || `Vendedor ${idx + 1}`).trim(),
        email: p.email?.trim() || null,
      })),
      ...compradores.map((p, idx) => ({
        sourceKind: "comprador" as const,
        sourceIndex: idx,
        name: (p.nome || p.razao_social || `Comprador ${idx + 1}`).trim(),
        email: p.email?.trim() || null,
      })),
    ];
  }, [vendedores, compradores]);

  // Filtra só envelopes attachment-based; os contract-based ficam nas seções
  // específicas de cada contrato logo abaixo.
  const attachmentEnvelopes = envelopes.filter((e) => e.source === "attachment");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSignature className="h-4 w-4" />
            Documentos avulsos
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Envie qualquer PDF da pasta Documentos pra assinatura — sem
            precisar passar por aprovação de CCV.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={refetch} title="Atualizar">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={attachments.length === 0}
            title={
              attachments.length === 0
                ? "Suba um PDF na aba Documentos primeiro"
                : undefined
            }
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Enviar documento da pasta
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando envelopes...
          </div>
        ) : attachmentEnvelopes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum documento avulso enviado para assinatura ainda.
          </p>
        ) : (
          attachmentEnvelopes.map((env) => (
            <AttachmentEnvelopeRow
              key={env.id}
              envelope={env}
              dealId={dealId}
              onChange={refetch}
            />
          ))
        )}
      </CardContent>

      <SendAttachmentEnvelopeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        dealId={dealId}
        attachments={attachments}
        partySuggestions={partySuggestions}
        onSent={refetch}
      />
    </Card>
  );
}

function AttachmentEnvelopeRow({
  envelope,
  dealId,
  onChange,
}: {
  envelope: ReturnType<typeof useDealEnvelopePolling>["envelopes"][number];
  dealId: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const signedCount = envelope.signers.filter((s) => s.status === "signed").length;
  const totalActive = envelope.signers.filter((s) => s.status !== "removed").length;
  const canCancel = envelope.status === "draft" || envelope.status === "running";

  const handleCancel = async () => {
    if (
      !confirm(
        "Cancelar este envelope? Os signatários não conseguirão mais assinar."
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/envelopes/${envelope.id}`,
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

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {envelope.subjectLabel || envelope.name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {STATUS_LABEL[envelope.status]} · {signedCount}/{totalActive} assinaram
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[envelope.status]} className="text-[10px]">
            {STATUS_LABEL[envelope.status]}
          </Badge>
          {envelope.signedDocumentUrl && envelope.status === "closed" && (
            <Button size="sm" variant="ghost" asChild>
              <a
                href={envelope.signedDocumentUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                PDF assinado
              </a>
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={busy}
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="px-3 py-2 space-y-1 text-xs">
        {envelope.signers.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">
              {s.name} <span className="text-muted-foreground">({s.email})</span>
            </span>
            <Badge variant="outline" className="text-[9px]">
              {SIGNER_STATUS_LABEL[s.status]}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContractEnvelopesSection({
  contract,
  vendedores,
  compradores,
  testemunhas,
  comissao,
}: {
  contract: ContractLite;
  vendedores: PartyLite[];
  compradores: PartyLite[];
  testemunhas: TestemunhaLite[];
  comissao: CorretoraLite | null;
}) {
  const { envelopes, loading, refetch } = useEnvelopePolling(contract.id);
  const [sendOpen, setSendOpen] = useState(false);

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
        contractStatus={contract.status}
        vendedores={vendedores}
        compradores={compradores}
        testemunhas={testemunhas}
        comissao={comissao}
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
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{signer.name}</span>
            <Badge variant="outline" className="text-xs h-5 capitalize">
              {signer.sourceKind}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {signer.email}
          </div>
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
