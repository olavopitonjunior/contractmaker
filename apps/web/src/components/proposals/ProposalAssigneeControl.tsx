"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { initials } from "@/lib/proposals/status-view";

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus:outline-hidden focus:ring-2 focus:ring-ring";

/**
 * Dialog de atribuição de responsável — extraído do controle do detalhe pra
 * também ser invocável do menu ⋯ da LISTA (antes atribuir exigia abrir a
 * proposta; o prop `assign` do RowActions existia mas nunca era usado).
 */
export function ProposalAssigneeDialog({
  proposalId,
  members,
  open,
  onOpenChange,
  initialUserId = "",
}: {
  proposalId: string;
  members: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUserId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState(initialUserId);
  const [freeName, setFreeName] = useState("");

  async function save(body: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/assignee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success("Responsável atualizado");
      onOpenChange(false);
      setFreeName("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atribuir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Responsável pela proposta</DialogTitle>
          <DialogDescription>
            Escolha um corretor da equipe ou informe o nome de um corretor externo (que não
            usa a plataforma).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Corretor da equipe
            </label>
            <select
              className={selectCls}
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                if (e.target.value) setFreeName("");
              }}
            >
              <option value="">— selecione —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-center text-xs text-muted-foreground">ou</div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Corretor externo (nome livre)
            </label>
            <Input
              value={freeName}
              placeholder="Ex.: João da Imobiliária Parceira"
              onChange={(e) => {
                setFreeName(e.target.value);
                if (e.target.value) setUserId("");
              }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => save({ clear: true })}
          >
            Remover responsável
          </Button>
          <Button
            disabled={busy || (!userId && freeName.trim().length < 2)}
            onClick={() =>
              save(userId ? { responsibleUserId: userId } : { responsibleName: freeName.trim() })
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProposalAssigneeControl({
  proposalId,
  responsible,
  responsibleUserId,
  members,
  canAssign,
}: {
  proposalId: string;
  responsible: { name: string; isNonUser: boolean; image: string | null };
  responsibleUserId: string | null;
  members: { id: string; name: string }[];
  canAssign: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8">
          {responsible.image && <AvatarImage src={responsible.image} />}
          <AvatarFallback className="text-xs">{initials(responsible.name)}</AvatarFallback>
        </Avatar>
        <div>
          <div className="text-sm font-medium leading-tight">{responsible.name}</div>
          <div className="text-xs text-muted-foreground">
            {responsible.isNonUser ? "Corretor externo" : "Responsável"}
          </div>
        </div>
        {responsible.isNonUser && (
          <Badge variant="outline" className="text-[10px]">
            externo
          </Badge>
        )}
      </div>

      {canAssign && (
        <>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Alterar
          </Button>
          <ProposalAssigneeDialog
            proposalId={proposalId}
            members={members}
            open={open}
            onOpenChange={setOpen}
            initialUserId={responsibleUserId ?? ""}
          />
        </>
      )}
    </div>
  );
}
