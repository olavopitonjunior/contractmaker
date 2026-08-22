"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSignature, Loader2, RefreshCw, Send } from "lucide-react";
import { useEnvelopePolling } from "@/hooks/useEnvelopePolling";
import { EnvelopeCard } from "@/components/pipeline/SignaturesTab";
import {
  SendLeaseEnvelopeDialog,
  type LeaseSignerData,
  type LeaseEnvelopeVariant,
} from "@/components/locacao/SendLeaseEnvelopeDialog";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { NO_PERMISSION_HINT } from "@/lib/security/rbac/ui";

interface LeaseSignaturesTabProps {
  contractId: string;
  contractStatus: string;
  /** Partes do contrato (locador/locatário/fiador) pra popup de envio. Quando
   *  ausente, cai no envio direto (deriva do dataJson no servidor). */
  data?: LeaseSignerData;
  /** Instrumento sendo assinado — locação (default) ou administração. */
  variant?: LeaseEnvelopeVariant;
  /** Nome da org pra pré-preencher a linha da imobiliária (variant administracao). */
  imobiliaria?: { nome?: string };
  /** LeaseContract do deal — habilita anexar o laudo de vistoria no mesmo
   *  envelope do contrato (uma cobrança por signatário em vez de duas). */
  leaseContractId?: string;
}

/**
 * Aba "Assinaturas" do deal de locação. Espelha o fluxo de venda em produção,
 * porém enxuta: o contrato é gerado/editado no Google Docs (aba Contrato), e
 * aqui o operador apenas dispara o envio para a ClickSign após aprovar.
 *
 * Com `data` (partes do contrato), abre o `SendLeaseEnvelopeDialog` — popup
 * editável com locador/locatário/fiador + testemunhas padrão + revisão, que
 * envia a lista EXPLÍCITA de signatários. Sem `data`, cai no envio direto
 * (POST sem signers → executor deriva via `leaseDataToSigners`). Reusa
 * EnvelopeCard de SignaturesTab e o hook de polling de envelopes.
 */
export function LeaseSignaturesTab({
  contractId,
  contractStatus,
  data,
  variant = "locacao",
  imobiliaria,
  leaseContractId,
}: LeaseSignaturesTabProps) {
  const { envelopes, loading, refetch } = useEnvelopePolling(contractId);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const perms = usePermissions();
  // Gating de envio (feature Gerente) — libera enquanto carrega pra não piscar.
  const canSend = perms.loading || perms.can(PERMISSION.ENVELOPE_SEND);

  const isApproved = contractStatus === "aprovado";
  const hasActiveOrClosed = envelopes.some(
    (e) => e.status === "running" || e.status === "closed"
  );

  // "Atualizar" pulla cada envelope ativo direto da ClickSign antes do refetch
  // — resolve status stale quando o webhook não chegou.
  const handleSyncAndRefetch = async () => {
    setSyncing(true);
    try {
      const active = envelopes.filter(
        (e) => e.status === "running" || e.status === "draft"
      );
      await Promise.allSettled(
        active.map((env) =>
          fetch(`/api/contracts/${contractId}/envelopes/${env.id}/sync`, {
            method: "POST",
          })
        )
      );
      await refetch();
    } catch {
      await refetch();
    } finally {
      setSyncing(false);
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/envelopes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authMethod: "email" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(body.missing)) {
          const names = body.missing
            .map((m: { name?: string }) => m.name)
            .filter(Boolean)
            .join(", ");
          throw new Error(
            `Partes sem e-mail: ${names || "verifique locador/locatário/fiador"}.`
          );
        }
        // Limite do PLANO da conta ClickSign (recusa da própria ClickSign).
        if (res.status === 402) {
          throw new Error(
            body.error || "A conta ClickSign está sem envelopes disponíveis."
          );
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success("Contrato enviado para assinatura.");
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao enviar para assinatura"
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSignature className="h-4 w-4" />
            Assinatura eletrônica
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {variant === "administracao"
              ? "Revise os signatários (proprietário, imobiliária e testemunhas) na popup antes de enviar."
              : "Revise os signatários (locador, locatário, fiador e testemunhas) na popup antes de enviar."}
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
            onClick={() => (data ? setDialogOpen(true) : handleSend())}
            disabled={!isApproved || hasActiveOrClosed || sending || !canSend}
            title={
              !canSend
                ? NO_PERMISSION_HINT
                : !isApproved
                  ? "Aprove o contrato na aba Contrato antes de enviar"
                  : hasActiveOrClosed
                    ? "Já existe um envelope para este contrato"
                    : undefined
            }
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1.5" />
            )}
            {hasActiveOrClosed ? "Já enviado" : "Enviar para assinatura"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isApproved && (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Aprove o contrato na aba <strong>Contrato</strong> para liberar o
            envio para assinatura.
          </p>
        )}
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando envelopes...
          </div>
        ) : envelopes.length === 0 ? (
          isApproved && (
            <p className="text-sm text-muted-foreground">
              Ainda não há envelopes enviados para este contrato.
            </p>
          )
        ) : (
          envelopes.map((env) => (
            <EnvelopeCard
              key={env.id}
              envelope={env}
              basePath={`/api/contracts/${contractId}/envelopes/${env.id}`}
              onChange={refetch}
            />
          ))
        )}
      </CardContent>

      {data && (
        <SendLeaseEnvelopeDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          contractId={contractId}
          contractStatus={contractStatus}
          data={data}
          variant={variant}
          imobiliaria={imobiliaria}
          leaseContractId={leaseContractId}
          onSent={refetch}
        />
      )}
    </Card>
  );
}
