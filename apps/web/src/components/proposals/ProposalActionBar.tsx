"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Bell, CheckCircle2, FileSignature, Ban, Trash2, UserCheck } from "lucide-react";
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
import type { ProposalPermissions } from "./ProposalRowActions";
import {
  CANCELLABLE_STATUSES,
  DELETABLE_STATUSES,
  REMINDABLE_STATUSES,
  CONVERTABLE_STATUSES,
  CONVERT_UNSIGNED_STATUSES,
} from "@/lib/proposals/status-sets";

export function ProposalActionBar({
  proposal,
  permissions,
}: {
  proposal: { id: string; status: string; instrument: string; convertedDealId: string | null };
  permissions: ProposalPermissions;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "cancel" | "delete" | "convertUnsigned">(null);
  const [reason, setReason] = useState("");

  const { status, instrument } = proposal;
  const canSend = permissions.send && (status === "rascunho" || status === "falha_envio");
  const canSendVendedor = permissions.send && status === "aguardando_vendedor";
  const canRemind =
    permissions.resend && REMINDABLE_STATUSES.has(status) && instrument === "envelope";
  const canConvert = permissions.convert && CONVERTABLE_STATUSES.has(status);
  const canConvertUnsigned =
    permissions.convert && !canConvert && CONVERT_UNSIGNED_STATUSES.has(status);
  const canCancel = permissions.cancel && CANCELLABLE_STATUSES.has(status);
  const canDelete =
    permissions.delete && DELETABLE_STATUSES.has(status) && !proposal.convertedDealId;

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
      if (!res.ok) {
        if (d.error === "preflight" && Array.isArray(d.issues)) {
          throw new Error(
            "Corrija antes de enviar: " +
              d.issues.map((i: { reason: string }) => i.reason).join(" · ")
          );
        }
        throw new Error(
          d.error === "budget" ? "Orçamento de assinaturas excedido." : d.error ?? `HTTP ${res.status}`
        );
      }
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
        <Button disabled={busy} onClick={() => run(`/api/proposals/${proposal.id}/send-vendedor`, jsonPost(), "Enviado ao vendedor")}>
          <UserCheck className="mr-1.5 h-4 w-4" /> Enviar ao vendedor
        </Button>
      )}
      {canRemind && (
        <Button variant="outline" disabled={busy} onClick={() => run(`/api/proposals/${proposal.id}/remind`, jsonPost(), "Lembrete enviado")}>
          <Bell className="mr-1.5 h-4 w-4" /> Reenviar / lembrar
        </Button>
      )}
      {canConvert && (
        <Button disabled={busy} onClick={() => run(`/api/proposals/${proposal.id}/convert`, jsonPost(), "Convertida em negócio", { dealRedirect: true })}>
          <CheckCircle2 className="mr-1.5 h-4 w-4" /> Converter em negócio
        </Button>
      )}
      {canConvertUnsigned && (
        <Button variant="outline" disabled={busy} onClick={() => setDialog("convertUnsigned")}>
          <FileSignature className="mr-1.5 h-4 w-4" /> Converter sem assinatura
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
            <AlertDialogTitle>Converter sem assinatura</AlertDialogTitle>
            <AlertDialogDescription>
              A proposta vira negócio mesmo sem a assinatura concluída. Informe o motivo — fica no
              histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" rows={3} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || reason.trim().length < 3}
              onClick={(e) => {
                e.preventDefault();
                run(
                  `/api/proposals/${proposal.id}/convert`,
                  jsonPost({ allowUnsigned: true, unsignedReason: reason }),
                  "Convertida em negócio",
                  { dealRedirect: true }
                );
              }}
            >
              Converter
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
