"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Send,
  Bell,
  CheckCircle2,
  FileSignature,
  Ban,
  Trash2,
  UserCheck,
  CopyPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { ManagerSelect } from "@/components/deals/ManagerSelect";
import type { ProposalPermissions } from "./ProposalRowActions";
import {
  CANCELLABLE_STATUSES,
  DELETABLE_STATUSES,
  isFalhaEnvioAlreadyDelivered,
  REMINDABLE_STATUSES,
  CONVERTABLE_STATUSES,
  CONVERT_UNSIGNED_STATUSES,
  SEND_VENDEDOR_STATUSES,
  AWAITING_DECISION_STATUSES,
} from "@/lib/proposals/status-sets";
import { useConvertProposal } from "@/lib/proposals/use-convert-proposal";
import { parseProposalApiError } from "@/lib/proposals/api-errors";
import {
  EnviarProprietarioDialog,
  type PlanVendedor,
} from "./EnviarProprietarioDialog";
import {
  RecreateProposalDialog,
  canRecreateProposal,
  recreateNeedsCancel,
  recreateHref,
} from "./RecreateProposalDialog";

export function ProposalActionBar({
  proposal,
  permissions,
  kind = "venda",
  vendedores = [],
  custoLabel = null,
}: {
  proposal: {
    id: string;
    status: string;
    kind: string;
    instrument: string;
    convertedDealId: string | null;
    /** `Proposal.sentAt` em ISO — ver RowProposal.sentAt. */
    sentAt: string | null;
    /** Já recriada (aponta pra filha) → o botão "Recriar" some. */
    supersededById?: string | null;
  };
  permissions: ProposalPermissions;
  /** venda | locacao — só muda a copy (proprietário × locador). */
  kind?: string;
  vendedores?: PlanVendedor[];
  custoLabel?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<
    | null
    | "cancel"
    | "delete"
    | "convertUnsigned"
    | "convertManager"
    | "complete"
    | "recreate"
  >(null);
  const [sendVendedorOpen, setSendVendedorOpen] = useState(false);
  const [reason, setReason] = useState("");
  // Gerente responsável (feature Gerente): só entra em cena quando o servidor
  // responde 422 `gerente_obrigatorio` — aí o diálogo ganha o ManagerSelect.
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const [managerRequired, setManagerRequired] = useState(false);
  const { convert, busy: convertBusy } = useConvertProposal();

  const vendedorLabel = kind === "locacao" ? "locador" : "proprietário";
  const { status, instrument } = proposal;
  // Parcialmente assinada (proponente ok, falta vendedor) — o diálogo "sem
  // assinatura" precisa dizer isso, senão parece que NINGUÉM assinou.
  const partialSigned =
    status === "assinada_proponente" || status === "aguardando_vendedor";

  function doConvert(opts: { allowUnsigned?: boolean } = {}) {
    void convert({
      proposalId: proposal.id,
      kind: proposal.kind,
      allowUnsigned: opts.allowUnsigned,
      unsignedReason: opts.allowUnsigned ? reason : undefined,
      managerUserId,
      onManagerRequired: () => {
        setManagerRequired(true);
        // Conversão direta não tem diálogo — abre um só pro gerente. A "sem
        // assinatura" já está aberta e ganha o ManagerSelect inline.
        if (!opts.allowUnsigned) setDialog("convertManager");
      },
      onSuccess: () => {
        setDialog(null);
        setReason("");
      },
    });
  }
  const canSend = permissions.send && (status === "rascunho" || status === "falha_envio");
  // Parada de decisão (caminho feliz) + retry em aguardando_vendedor.
  const canSendVendedor = permissions.send && SEND_VENDEDOR_STATUSES.has(status);
  const canComplete = permissions.send && AWAITING_DECISION_STATUSES.has(status);
  const canRemind =
    permissions.resend && REMINDABLE_STATUSES.has(status) && instrument === "envelope";
  const canConvert = permissions.convert && CONVERTABLE_STATUSES.has(status);
  const canConvertUnsigned =
    permissions.convert && !canConvert && CONVERT_UNSIGNED_STATUSES.has(status);
  const canCancel = permissions.cancel && CANCELLABLE_STATUSES.has(status);
  // Recriar = cancelar (quando ainda viva) + novo rascunho pré-preenchido.
  // Some depois de recriada (supersededById) — evita ramificação acidental; o
  // detalhe mostra o link "Recriada como" no lugar. No caminho vivo o cancel é
  // parte da ação, então `permissions.cancel` também é exigida.
  const canRecreate = canRecreateProposal(
    { status, convertedDealId: proposal.convertedDealId, supersededById: proposal.supersededById },
    permissions
  );
  // Espelha o guard do DELETE, igual à lista — ver ProposalRowActions.
  const canDelete =
    permissions.delete &&
    DELETABLE_STATUSES.has(status) &&
    !isFalhaEnvioAlreadyDelivered({ status, sentAt: proposal.sentAt }) &&
    !proposal.convertedDealId;

  async function run(
    url: string,
    init: RequestInit,
    okMsg: string,
    opts: { dealRedirect?: boolean; redirectPath?: string } = {}
  ) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseProposalApiError(d, res.status));
      // Distingue o canal real no envio: só /send devolve `instrument`. Aceite via
      // WhatsApp ≠ envelope de assinatura — não anunciar "Enviado para assinatura".
      toast.success(d.instrument === "aceite" ? "Enviado por Aceite via WhatsApp" : okMsg);

      // Avisos do roteamento: o envio pode ter sido REBAIXADO (assinatura →
      // Aceite, ou WhatsApp → e-mail) sem que o corretor tenha pedido isso.
      // Duração longa e dismissível — some junto com o toast de sucesso perderia
      // exatamente a informação que importa.
      if (Array.isArray(d.warnings)) {
        for (const w of d.warnings as string[]) {
          toast.warning(w, { duration: 15000, closeButton: true });
        }
      }
      setDialog(null);
      setReason("");
      if (opts.redirectPath) router.push(opts.redirectPath);
      else if (opts.dealRedirect && d.dealId) router.push(`/deals/${d.dealId}`);
      else router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na ação");
      // Fecha TAMBÉM no erro. Antes só o sucesso fechava, então uma ação
      // recusada pelo servidor deixava o diálogo de confirmação aberto com o
      // toast por cima: o usuário lia "não pode" e continuava olhando pro
      // botão "Confirmar", parecendo travado. Nenhum diálogo que passa por
      // aqui tem como o usuário corrigir e repetir de dentro dele — o 422
      // `gerente_obrigatorio`, que é o único caso assim, vai por
      // `useConvertProposal` e não por esta função.
      //
      // `reason` NÃO é limpo aqui de propósito: reabrir traz o texto que a
      // pessoa já tinha escrito.
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  const jsonPost = (body?: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canSend && (
        <Button disabled={busy} onClick={() => run(`/api/proposals/${proposal.id}/send`, jsonPost(), "Enviado para assinatura")}>
          <Send className="mr-1.5 h-4 w-4" /> Enviar para assinatura
        </Button>
      )}
      {canSendVendedor && (
        <Button disabled={busy} onClick={() => setSendVendedorOpen(true)}>
          <UserCheck className="mr-1.5 h-4 w-4" /> Enviar ao {vendedorLabel}
        </Button>
      )}
      {canComplete && (
        <Button variant="outline" disabled={busy} onClick={() => setDialog("complete")}>
          <CheckCircle2 className="mr-1.5 h-4 w-4" /> Concluir sem enviar
        </Button>
      )}
      {canRemind && (
        <Button variant="outline" disabled={busy} onClick={() => run(`/api/proposals/${proposal.id}/remind`, jsonPost(), "Lembrete enviado")}>
          <Bell className="mr-1.5 h-4 w-4" /> Reenviar / lembrar
        </Button>
      )}
      {canConvert && (
        <Button disabled={busy || convertBusy} onClick={() => doConvert()}>
          <CheckCircle2 className="mr-1.5 h-4 w-4" /> Converter em negócio
        </Button>
      )}
      {canConvertUnsigned && (
        <Button variant="outline" disabled={busy || convertBusy} onClick={() => setDialog("convertUnsigned")}>
          <FileSignature className="mr-1.5 h-4 w-4" />{" "}
          {partialSigned ? "Converter sem assinatura completa" : "Converter sem assinatura"}
        </Button>
      )}
      {canRecreate && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (recreateNeedsCancel(status)) setDialog("recreate");
            else router.push(recreateHref(proposal.id));
          }}
        >
          <CopyPlus className="mr-1.5 h-4 w-4" /> Recriar proposta
        </Button>
      )}
      {canCancel && (
        <Button variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setDialog("cancel")}>
          <Ban className="mr-1.5 h-4 w-4" /> Cancelar
        </Button>
      )}
      {canDelete && (
        <Button variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setDialog("delete")}>
          <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
        </Button>
      )}

      <EnviarProprietarioDialog
        open={sendVendedorOpen}
        onOpenChange={setSendVendedorOpen}
        proposalId={proposal.id}
        vendedorLabel={vendedorLabel}
        vendedores={vendedores}
        custoLabel={custoLabel}
      />

      {/* Concluir sem enviar (motivo OPCIONAL) */}
      <AlertDialog open={dialog === "complete"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Concluir sem enviar ao {vendedorLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              A proposta fecha como concluída com a assinatura do proponente — a via
              do {vendedorLabel} não será enviada. Motivo é opcional e fica no
              histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" rows={3} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                run(
                  `/api/proposals/${proposal.id}/complete`,
                  jsonPost({ reason: reason.trim() || undefined }),
                  "Proposta concluída"
                );
              }}
            >
              Concluir proposta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RecreateProposalDialog
        open={dialog === "recreate"}
        onOpenChange={(o) => !o && setDialog(null)}
        proposalId={proposal.id}
        status={status}
      />

      {/* Cancelar (com motivo) */}
      <AlertDialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar proposta</AlertDialogTitle>
            <AlertDialogDescription>
              Encerra a proposta (sem excluir) e cancela as assinaturas em curso na ClickSign.
              Informe o motivo — fica no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo do cancelamento" rows={3} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={busy || reason.trim().length < 3}
              onClick={(e) => {
                e.preventDefault();
                run(`/api/proposals/${proposal.id}/cancel`, jsonPost({ reason }), "Proposta cancelada");
              }}
            >
              Cancelar proposta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Converter sem assinatura (com motivo) */}
      <AlertDialog open={dialog === "convertUnsigned"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {partialSigned ? "Converter sem assinatura completa" : "Converter sem assinatura"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {partialSigned
                ? "O proponente já assinou; o vendedor ainda não. A proposta vira negócio sem esperar a assinatura dele. Informe o motivo — fica no histórico."
                : "A proposta vira negócio mesmo sem a assinatura concluída. Informe o motivo — fica no histórico."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" rows={3} />
          {managerRequired && (
            <ManagerSelect
              value={managerUserId}
              onChange={setManagerUserId}
              disabled={convertBusy}
              onContextLoaded={(ctx) => setManagerRequired(ctx.managerRequired)}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convertBusy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                convertBusy ||
                reason.trim().length < 3 ||
                (managerRequired && !managerUserId)
              }
              onClick={(e) => {
                e.preventDefault();
                doConvert({ allowUnsigned: true });
              }}
            >
              Converter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Gerente obrigatório na conversão direta (422 do servidor) */}
      <AlertDialog open={dialog === "convertManager"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerente responsável</AlertDialogTitle>
            <AlertDialogDescription>
              A organização exige um gerente responsável pelo negócio criado. Selecione e confirme
              a conversão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ManagerSelect
            value={managerUserId}
            onChange={setManagerUserId}
            disabled={convertBusy}
            onContextLoaded={(ctx) => setManagerRequired(ctx.managerRequired)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convertBusy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={convertBusy || !managerUserId}
              onClick={(e) => {
                e.preventDefault();
                doConvert();
              }}
            >
              Converter em negócio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Excluir */}
      <AlertDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir proposta</AlertDialogTitle>
            <AlertDialogDescription>
              Ação permanente: remove a proposta e o histórico. Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                run(`/api/proposals/${proposal.id}`, { method: "DELETE" }, "Proposta excluída", {
                  redirectPath: "/pipeline/propostas",
                });
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
