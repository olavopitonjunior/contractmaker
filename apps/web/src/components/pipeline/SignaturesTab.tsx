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
import { AddSignerDialog } from "./AddSignerDialog";
import { clicksignRoleLabel } from "@/lib/clicksign/roles";
import { buildPartySuggestions, type PartyLike } from "@/lib/clicksign/party-suggestions";
import { UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { NO_PERMISSION_HINT } from "@/lib/security/rbac/ui";

/**
 * Gating de envio (feature Gerente). Enquanto as permissões carregam, libera —
 * o botão não pisca de habilitado pra bloqueado. `usePermissions` tem cache em
 * memória, então cada seção pode chamar sem custo de rede extra.
 */
function useCanSendEnvelope(): boolean {
  const perms = usePermissions();
  return perms.loading || perms.can(PERMISSION.ENVELOPE_SEND);
}

/**
 * Parte do dataJson. Reusa `PartyLike` do helper de sugestões (que já cobre
 * cônjuge/procurador/representante e celular) e acrescenta os campos que só
 * esta aba consome. O tipo estreito anterior escondia as sub-partes.
 */
interface PartyLite extends PartyLike {
  conjuge?: {
    nome?: string;
    cpf?: string;
    email?: string;
    mobile_phone?: string;
    incluir_como_signatario?: boolean;
  };
}

interface TestemunhaLite {
  nome?: string;
  cpf?: string;
  email?: string;
  incluir_como_signatario?: boolean;
}

interface ComissionadoLite {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: string;
  email?: string;
  percentual?: number;
  valor?: number;
  incluir_como_signatario?: boolean;
}

interface CorretoraLite {
  corretora_tipo_pessoa?: string;
  imobiliaria_nome?: string;
  imobiliaria_cnpj?: string;
  imobiliaria_email?: string;
  creci?: string;
  incluir_como_signatario?: boolean;
  comissionados?: ComissionadoLite[];
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
  email_failed: "E-mail não entregue",
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
  const [syncing, setSyncing] = useState(false);

  // "Atualizar" pulla cada envelope avulso ativo direto da ClickSign antes do
  // refetch — resolve status stale quando o webhook não chegou.
  const handleSyncAndRefetch = async () => {
    setSyncing(true);
    try {
      const active = envelopes.filter(
        (e) => e.source === "attachment" && (e.status === "running" || e.status === "draft")
      );
      await Promise.allSettled(
        active.map((env) =>
          fetch(`/api/deals/${dealId}/envelopes/${env.id}/sync`, { method: "POST" })
        )
      );
      await refetch();
    } catch {
      await refetch();
    } finally {
      setSyncing(false);
    }
  };

  // Titular + cônjuge + procurador + representante legal da PJ, com papel
  // default já resolvido. Ver lib/clicksign/party-suggestions.ts.
  const partySuggestions = useMemo(
    () => buildPartySuggestions(vendedores, compradores),
    [vendedores, compradores]
  );

  // Filtra só envelopes attachment-based; os contract-based ficam nas seções
  // específicas de cada contrato logo abaixo.
  const attachmentEnvelopes = envelopes.filter((e) => e.source === "attachment");
  const canSend = useCanSendEnvelope();

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
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSyncAndRefetch}
            title="Sincronizar com ClickSign e atualizar"
            disabled={syncing}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={attachments.length === 0 || !canSend}
            title={
              !canSend
                ? NO_PERMISSION_HINT
                : attachments.length === 0
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
            <EnvelopeCard
              key={env.id}
              envelope={env}
              basePath={`/api/deals/${dealId}/envelopes/${env.id}`}
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
  const [syncing, setSyncing] = useState(false);

  // "Atualizar" não faz só refetch local — primeiro pulla cada envelope
  // ativo direto da ClickSign API, então re-fetch do DB. Resolve casos
  // em que webhook não chegou (Marcia assinou mas status local stale).
  const handleSyncAndRefetch = async () => {
    setSyncing(true);
    try {
      const active = envelopes.filter(
        (e) => e.status === "running" || e.status === "draft"
      );
      const results = await Promise.allSettled(
        active.map((env) =>
          fetch(
            `/api/contracts/${contract.id}/envelopes/${env.id}/sync`,
            { method: "POST" }
          )
        )
      );
      const failures = results.filter(
        (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)
      ).length;
      if (failures > 0 && active.length > 0) {
        toast.warning(
          `Sincronização parcial — ${failures}/${active.length} envelope(s) falharam. Mostrando últimos dados locais.`
        );
      }
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao sincronizar com ClickSign"
      );
      await refetch();
    } finally {
      setSyncing(false);
    }
  };

  const hasActiveOrClosed = envelopes.some(
    (e) => e.status === "running" || e.status === "closed"
  );
  const canSend = useCanSendEnvelope();

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
            onClick={handleSyncAndRefetch}
            title="Sincronizar com ClickSign e atualizar"
            disabled={syncing}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                syncing && "animate-spin"
              )}
            />
          </Button>
          <Button
            size="sm"
            onClick={() => setSendOpen(true)}
            disabled={hasActiveOrClosed || !canSend}
            title={canSend ? undefined : NO_PERMISSION_HINT}
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
              basePath={`/api/contracts/${contract.id}/envelopes/${env.id}`}
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
          <div className="text-xs text-muted-foreground truncate">
            {signer.email}
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
