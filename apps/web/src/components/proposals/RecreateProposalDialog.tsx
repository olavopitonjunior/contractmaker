"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  CANCELLABLE_STATUSES,
  RECREATABLE_STATUSES,
  SEND_VENDEDOR_STATUSES,
} from "@/lib/proposals/status-sets";
import { parseProposalApiError } from "@/lib/proposals/api-errors";
import type { ProposalPermissions } from "./ProposalRowActions";

/** URL do rascunho pré-preenchido a partir desta proposta. */
export function recreateHref(proposalId: string): string {
  return `/pipeline/propostas/nova?fromId=${proposalId}`;
}

/**
 * Status vivo: a recriação passa pelo POST /cancel antes de abrir o rascunho.
 * Terminal recriável navega direto (e o servidor SÓ aceita terminal — ver o
 * gate de status no POST /api/proposals).
 */
export function recreateNeedsCancel(status: string): boolean {
  return CANCELLABLE_STATUSES.has(status);
}

/**
 * Predicado ÚNICO do "Recriar proposta" — lista e detalhe oferecem a ação sob
 * exatamente as mesmas condições.
 *
 * `create` (PROPOSAL_CREATE puro) e não `write`: a ação TERMINA num POST de
 * criação, então um SEND-sem-CREATE cancelaria a proposta (metade destrutiva)
 * e esbarraria no 403 da criação. No caminho vivo o cancel faz parte da ação,
 * daí `cancel` também.
 */
export function canRecreateProposal(
  proposal: { status: string; convertedDealId: string | null; supersededById?: string | null },
  permissions: ProposalPermissions
): boolean {
  return (
    permissions.create &&
    RECREATABLE_STATUSES.has(proposal.status) &&
    !proposal.supersededById &&
    !proposal.convertedDealId &&
    (!recreateNeedsCancel(proposal.status) || permissions.cancel)
  );
}

/**
 * Cancela a proposta (com motivo) e abre o rascunho pré-preenchido.
 *
 * Compartilhado entre `ProposalActionBar` (detalhe) e `ProposalRowActions`
 * (linha da lista): as duas cópias anteriores já divergiam no nascimento (copy
 * do aviso de assinatura e checagem de status inline vs. `partialSigned`), e o
 * próximo ajuste — v2 que copie documentos, reword do aviso ClickSign — teria
 * que ser feito duas vezes.
 */
export function RecreateProposalDialog({
  open,
  onOpenChange,
  proposalId,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  status: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Proponente já assinou (parada de decisão ou 2ª via em curso): a assinatura
  // colhida morre junto com o envelope, e isso precisa estar dito ANTES.
  const partialSigned = SEND_VENDEDOR_STATUSES.has(status);

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseProposalApiError(d, res.status));
      toast.success("Proposta cancelada — abrindo a recriação");
      onOpenChange(false);
      router.push(recreateHref(proposalId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na ação");
      // Fecha também no erro (mesmo motivo dos outros diálogos da tela): o
      // usuário não tem como corrigir e repetir de dentro dele. `reason` fica.
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recriar proposta</AlertDialogTitle>
          <AlertDialogDescription>
            Esta proposta será <strong>cancelada</strong> (assinaturas em curso na
            ClickSign são canceladas junto) e um novo rascunho abre pré-preenchido
            com os mesmos dados, pronto pra revisar e reenviar.
            {partialSigned && (
              <>
                {" "}
                <strong>Atenção:</strong> o proponente já assinou esta via — a
                assinatura dele será descartada e precisará ser colhida de novo na
                proposta nova.
              </>
            )}{" "}
            Documentos anexados não são copiados. Informe o motivo — fica no
            histórico.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (ex.: dados preenchidos errados, cliente não recebeu)"
          rows={3}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || reason.trim().length < 3}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            Cancelar e recriar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
