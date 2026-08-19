"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FileSignature, RefreshCw, Send } from "lucide-react";
import { useEnvelopePolling } from "@/hooks/useEnvelopePolling";
import { useDealEnvelopePolling } from "@/hooks/useDealEnvelopePolling";
import { SendEnvelopeDialog } from "./SendEnvelopeDialog";
import { SendAttachmentEnvelopeDialog } from "./SendAttachmentEnvelopeDialog";
import { buildPartySuggestions, type PartyLike } from "@/lib/clicksign/party-suggestions";
import { cn } from "@/lib/utils";
// `EnvelopeCard` saiu daqui pra `components/signatures/` quando as PROPOSTAS
// passaram a precisar dele: proposta não é deal e não deve importar de
// `pipeline/`. Reexportado abaixo pra não quebrar quem já importava daqui.
import { EnvelopeCard } from "@/components/signatures/EnvelopeCard";

export { EnvelopeCard } from "@/components/signatures/EnvelopeCard";
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

