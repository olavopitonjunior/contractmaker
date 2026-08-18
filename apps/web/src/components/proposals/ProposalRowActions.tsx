"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MoreHorizontal,
  ExternalLink,
  Bell,
  Send,
  CheckCircle2,
  Ban,
  Trash2,
  UserRound,
  Briefcase,
} from "lucide-react";
import { ProposalAssigneeDialog } from "./ProposalAssigneeControl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
  DELETABLE_STATUSES,
  REMINDABLE_STATUSES,
  CONVERTABLE_STATUSES,
} from "@/lib/proposals/status-sets";
import {
  useConvertProposal,
  dealPathForKind,
} from "@/lib/proposals/use-convert-proposal";

export interface ProposalPermissions {
  send: boolean;
  convert: boolean;
  cancel: boolean;
  delete: boolean;
  resend: boolean;
  assign: boolean;
}

export interface RowProposal {
  id: string;
  status: string;
  kind: string;
  instrument: string;
  convertedDealId: string | null;
}

export function ProposalRowActions({
  proposal,
  permissions,
  members = [],
}: {
  proposal: RowProposal;
  permissions: ProposalPermissions;
  /** Membros da org pro dialog de atribuição (só usado com permissions.assign). */
  members?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "cancel" | "delete" | "assign">(null);
  const [reason, setReason] = useState("");
  const { convert, busy: convertBusy } = useConvertProposal();

  const canRemind =
    permissions.resend &&
    REMINDABLE_STATUSES.has(proposal.status) &&
    proposal.instrument === "envelope";
  const canSendVendedor = permissions.send && proposal.status === "aguardando_vendedor";
  const canConvert = permissions.convert && CONVERTABLE_STATUSES.has(proposal.status);
  const canCancel = permissions.cancel && CANCELLABLE_STATUSES.has(proposal.status);
  const canDelete =
    permissions.delete && DELETABLE_STATUSES.has(proposal.status) && !proposal.convertedDealId;

  async function run(url: string, init: RequestInit, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success(okMsg);
      setDialog(null);
      setReason("");
      router.refresh();
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
    <>
      {permissions.assign && dialog === "assign" && (
        <ProposalAssigneeDialog
          proposalId={proposal.id}
          members={members}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ações">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={`/pipeline/propostas/${proposal.id}`}>
              <ExternalLink className="mr-2 h-4 w-4" /> Abrir
            </Link>
          </DropdownMenuItem>

          {canRemind && (
            <DropdownMenuItem
              onClick={() => run(`/api/proposals/${proposal.id}/remind`, jsonPost(), "Lembrete enviado")}
            >
              <Bell className="mr-2 h-4 w-4" /> Reenviar / lembrar
            </DropdownMenuItem>
          )}
          {canSendVendedor && (
            <DropdownMenuItem
              onClick={() =>
                run(`/api/proposals/${proposal.id}/send-vendedor`, jsonPost(), "Enviado ao vendedor")
              }
            >
              <Send className="mr-2 h-4 w-4" /> Enviar ao vendedor
            </DropdownMenuItem>
          )}
          {canConvert && (
            <DropdownMenuItem
              disabled={convertBusy}
              onClick={() =>
                // Sem diálogo na linha — se a org exigir gerente (422), o hook
                // avisa; o ManagerSelect vive no detalhe da proposta.
                void convert({ proposalId: proposal.id, kind: proposal.kind })
              }
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Converter em negócio
            </DropdownMenuItem>
          )}
          {proposal.convertedDealId && (
            <DropdownMenuItem asChild>
              <Link href={dealPathForKind(proposal.kind, proposal.convertedDealId)}>
                <Briefcase className="mr-2 h-4 w-4" /> Ver negócio
              </Link>
            </DropdownMenuItem>
          )}
          {permissions.assign && (
            <DropdownMenuItem onClick={() => setDialog("assign")}>
              <UserRound className="mr-2 h-4 w-4" /> Atribuir responsável…
            </DropdownMenuItem>
          )}

          {(canCancel || canDelete) && <DropdownMenuSeparator />}
          {canCancel && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDialog("cancel")}
            >
              <Ban className="mr-2 h-4 w-4" /> Cancelar
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDialog("delete")}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar proposta</AlertDialogTitle>
            <AlertDialogDescription>
              A proposta é encerrada (não excluída) e as assinaturas em curso são canceladas na
              ClickSign. Informe o motivo — fica no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo do cancelamento"
            rows={3}
          />
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

      <AlertDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir proposta</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente e remove a proposta e seu histórico. Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                run(`/api/proposals/${proposal.id}`, { method: "DELETE" }, "Proposta excluída");
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
