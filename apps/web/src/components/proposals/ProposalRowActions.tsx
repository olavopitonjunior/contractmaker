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
  Pencil,
  CopyPlus,
} from "lucide-react";
import { ProposalAssigneeDialog } from "./ProposalAssigneeControl";
import { RenameProposalDialog } from "./RenameProposalDialog";
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
  isFalhaEnvioAlreadyDelivered,
  REMINDABLE_STATUSES,
  CONVERTABLE_STATUSES,
  AWAITING_DECISION_STATUSES,
  TERMINAL_STATUSES,
  RECREATABLE_STATUSES,
} from "@/lib/proposals/status-sets";
import {
  useConvertProposal,
  dealPathForKind,
} from "@/lib/proposals/use-convert-proposal";
import { parseProposalApiError } from "@/lib/proposals/api-errors";

export interface ProposalPermissions {
  send: boolean;
  /** Pode ESCREVER na proposta (renomear, editar). CREATE ou SEND — VIEW_ALL
   *  sozinho é leitura e não conta. Espelha o guard das rotas PATCH. */
  write: boolean;
  convert: boolean;
  cancel: boolean;
  delete: boolean;
  resend: boolean;
  assign: boolean;
}

export interface RowProposal {
  id: string;
  status: string;
  /** venda | locacao — rota do negócio e copy do proprietário × locador. */
  kind: string;
  instrument: string;
  convertedDealId: string | null;
  /** Título atual — abre o diálogo de renomear já preenchido. */
  title: string;
  /**
   * `Proposal.sentAt` em ISO. Obrigatório (aceita `null`): é o que separa
   * `falha_envio` que nunca saiu (excluível) de `falha_envio` que saiu e foi
   * cancelado (não se exclui — a API devolve 409). Opcional, um chamador que
   * esquecesse de passar ofereceria o botão morto de novo, sem erro de
   * compilação.
   */
  sentAt: string | null;
  /** Já recriada (aponta pra filha) → "Recriar" some da linha. */
  supersededById: string | null;
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
  const [dialog, setDialog] = useState<
    null | "cancel" | "delete" | "assign" | "rename" | "recreate"
  >(null);
  const [reason, setReason] = useState("");
  const { convert, busy: convertBusy } = useConvertProposal();

  const vendedorLabel = proposal.kind === "locacao" ? "locador" : "proprietário";
  const canRemind =
    permissions.resend &&
    REMINDABLE_STATUSES.has(proposal.status) &&
    proposal.instrument === "envelope";
  // Parada de decisão: a lista não decide — leva pro detalhe com o diálogo aberto.
  const isDecision = AWAITING_DECISION_STATUSES.has(proposal.status);
  // 2ª via em curso: o lembrete certo é o do proprietário (sourceKind=vendedor).
  const canRemindVendedor =
    permissions.resend &&
    proposal.status === "aguardando_vendedor" &&
    proposal.instrument === "envelope";
  // Renomear vale em qualquer status vivo (título é rótulo, não conteúdo) —
  // mesmo corte da rota PATCH .../title, que barra os terminais E exige
  // permissão de escrita: só VIEW_ALL (papel de leitura) não renomeia.
  const canRename = permissions.write && !TERMINAL_STATUSES.has(proposal.status);
  const canConvert = permissions.convert && CONVERTABLE_STATUSES.has(proposal.status);
  const canCancel = permissions.cancel && CANCELLABLE_STATUSES.has(proposal.status);
  // `!isFalhaEnvioAlreadyDelivered` espelha EXATAMENTE o guard do DELETE: sem
  // ele o botão reaparecia depois de cancelar o envelope e a API respondia 409
  // sempre — a UI decidindo por status, o servidor por sentAt.
  const canDelete =
    permissions.delete &&
    DELETABLE_STATUSES.has(proposal.status) &&
    !isFalhaEnvioAlreadyDelivered(proposal) &&
    !proposal.convertedDealId;
  // Mesmo gate do ProposalActionBar (detalhe): cancelar faz parte da ação nos
  // status vivos, então `cancel` também é exigida nesse caminho.
  const recreateNeedsCancel = CANCELLABLE_STATUSES.has(proposal.status);
  const canRecreate =
    permissions.write &&
    RECREATABLE_STATUSES.has(proposal.status) &&
    !proposal.supersededById &&
    !proposal.convertedDealId &&
    (!recreateNeedsCancel || permissions.cancel);
  const recreateHref = `/pipeline/propostas/nova?fromId=${proposal.id}`;

  async function run(
    url: string,
    init: RequestInit,
    okMsg: string,
    opts: { redirectPath?: string } = {}
  ) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseProposalApiError(d, res.status));
      toast.success(okMsg);
      setDialog(null);
      setReason("");
      if (opts.redirectPath) router.push(opts.redirectPath);
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
    <>
      {permissions.assign && dialog === "assign" && (
        <ProposalAssigneeDialog
          proposalId={proposal.id}
          members={members}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
      <RenameProposalDialog
        open={dialog === "rename"}
        onOpenChange={(o) => !o && setDialog(null)}
        proposalId={proposal.id}
        currentTitle={proposal.title}
      />
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
          {canRename && (
            <DropdownMenuItem onClick={() => setDialog("rename")}>
              <Pencil className="mr-2 h-4 w-4" /> Renomear…
            </DropdownMenuItem>
          )}

          {canRemind && (
            <DropdownMenuItem
              onClick={() => run(`/api/proposals/${proposal.id}/remind`, jsonPost(), "Lembrete enviado")}
            >
              <Bell className="mr-2 h-4 w-4" /> Reenviar / lembrar
            </DropdownMenuItem>
          )}
          {isDecision && permissions.send && (
            <DropdownMenuItem asChild>
              <Link href={`/pipeline/propostas/${proposal.id}?action=enviar-proprietario`}>
                <Send className="mr-2 h-4 w-4" /> Decidir: enviar ou concluir
              </Link>
            </DropdownMenuItem>
          )}
          {canRemindVendedor && (
            <DropdownMenuItem
              onClick={() =>
                run(
                  `/api/proposals/${proposal.id}/remind`,
                  jsonPost({ sourceKind: "vendedor" }),
                  `Lembrete enviado ao ${vendedorLabel}`
                )
              }
            >
              <Bell className="mr-2 h-4 w-4" /> Lembrar {vendedorLabel}
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

          {canRecreate && (
            <DropdownMenuItem
              onClick={() => {
                if (recreateNeedsCancel) setDialog("recreate");
                else router.push(recreateHref);
              }}
            >
              <CopyPlus className="mr-2 h-4 w-4" /> Recriar proposta…
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

      <AlertDialog open={dialog === "recreate"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recriar proposta</AlertDialogTitle>
            <AlertDialogDescription>
              Esta proposta será <strong>cancelada</strong> (assinaturas em curso
              na ClickSign são canceladas junto) e um novo rascunho abre
              pré-preenchido com os mesmos dados.
              {(proposal.status === "assinada_proponente" ||
                proposal.status === "aguardando_vendedor") && (
                <>
                  {" "}
                  <strong>Atenção:</strong> a assinatura já colhida do proponente
                  será descartada.
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
                run(
                  `/api/proposals/${proposal.id}/cancel`,
                  jsonPost({ reason }),
                  "Proposta cancelada — abrindo a recriação",
                  { redirectPath: recreateHref }
                );
              }}
            >
              Cancelar e recriar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
