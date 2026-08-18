"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/** Códigos de `ProposalConvertError` que a rota devolve em `{ error, code }`. */
export type ConvertProposalErrorCode =
  | "not_completa"
  | "already_converted"
  | "no_pipeline"
  | "dossier_pending"
  | "gerente_obrigatorio"
  | "gerente_invalido";

/** Detalhe do negócio por módulo — locação tem rota própria. */
export function dealPathForKind(kind: string, dealId: string): string {
  return kind === "locacao" ? `/locacao/deals/${dealId}` : `/deals/${dealId}`;
}

export type ConvertProposalResult =
  | { ok: true; dealId: string }
  | { ok: false; code: ConvertProposalErrorCode | null };

/**
 * Conversão proposta → negócio compartilhada entre ActionBar, menu da linha e o
 * picker do "Cadastro com proposta". Centraliza o POST e o tratamento por
 * `code` — antes cada call-site tinha o seu, o redirect era hard-coded
 * `/deals/` (locação caía no detalhe de venda) e o 422 `gerente_obrigatorio`
 * estourava como toast sem caminho de correção.
 */
export function useConvertProposal() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function convert(input: {
    proposalId: string;
    kind: string;
    allowUnsigned?: boolean;
    unsignedReason?: string;
    managerUserId?: string | null;
    /** Default true — vai pro negócio criado. `false` → só `router.refresh()`. */
    redirect?: boolean;
    /** Org exige gerente (422) — caller abre o ManagerSelect e re-chama. */
    onManagerRequired?: (message: string) => void;
    /** Corrida/duplo clique (409) — caller tira a proposta da lista. */
    onAlreadyConverted?: () => void;
    onSuccess?: (dealId: string) => void;
  }): Promise<ConvertProposalResult> {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${input.proposalId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(input.allowUnsigned
            ? { allowUnsigned: true, unsignedReason: input.unsignedReason }
            : {}),
          ...(input.managerUserId ? { managerUserId: input.managerUserId } : {}),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        dealId?: string;
        error?: string;
        code?: ConvertProposalErrorCode;
      };
      if (!res.ok) {
        const code = d.code ?? null;
        if (code === "gerente_obrigatorio") {
          const msg = d.error || "Selecione o gerente responsável.";
          if (input.onManagerRequired) input.onManagerRequired(msg);
          else toast.error(msg);
        } else if (code === "already_converted") {
          toast.error("Esta proposta já virou negócio.");
          input.onAlreadyConverted?.();
        } else {
          // Inclui `dossier_pending` — a mensagem do servidor já explica que o
          // documento assinado ainda está sendo processado (transitório).
          toast.error(d.error ?? `HTTP ${res.status}`);
        }
        return { ok: false, code };
      }
      toast.success("Convertida em negócio");
      if (d.dealId) input.onSuccess?.(d.dealId);
      if (input.redirect !== false && d.dealId) {
        router.push(dealPathForKind(input.kind, d.dealId));
      } else {
        router.refresh();
      }
      return { ok: true, dealId: d.dealId! };
    } catch {
      toast.error("Erro de rede na conversão. Tente novamente.");
      return { ok: false, code: null };
    } finally {
      setBusy(false);
    }
  }

  return { convert, busy };
}
