"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MoreVertical,
  Star,
  Edit,
  Archive,
  Loader2,
  Eye,
  Pencil,
} from "lucide-react";

interface Props {
  accountId: string;
  label: string | null;
  status: string;
  isActive: boolean;
  isArchived: boolean;
}

/**
 * Dropdown + ações inline por conta — somente owner renderiza este componente
 * (a página /contas filtra por isOwner antes de incluir).
 */
export function AccountsTableActions({
  accountId,
  label,
  status,
  isActive,
  isArchived,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [newLabel, setNewLabel] = useState(label ?? "");

  const canActivate = !isActive && status === "APPROVED" && !isArchived;
  const canArchive = !isActive && !isArchived;

  async function activate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/accounts/${accountId}/activate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "ELEVATION_REQUIRED") {
          toast.error("Confirmação de identidade necessária. Tente novamente.");
        } else {
          toast.error(data.error ?? "Sem permissão");
        }
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao ativar");
        return;
      }
      toast.success("Conta agora é a padrão da organização");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/accounts/${accountId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao arquivar");
        return;
      }
      toast.success("Conta arquivada");
      setConfirmArchive(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/accounts/${accountId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao renomear");
        return;
      }
      toast.success("Rótulo atualizado");
      setRenaming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Botão de renomear inline pra discoverability */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setNewLabel(label ?? "");
            setRenaming(true);
          }}
          title="Renomear conta"
          disabled={busy}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              title="Mais ações"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreVertical className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link href={`/settings/pagamentos/contas/${accountId}`}>
                <Eye className="h-4 w-4 mr-2" />
                Ver informações
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setNewLabel(label ?? "");
                setRenaming(true);
              }}
            >
              <Edit className="h-4 w-4 mr-2" />
              Editar nome
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={canActivate ? activate : undefined}
              disabled={!canActivate}
              title={
                isActive
                  ? "Esta conta já é a padrão"
                  : status !== "APPROVED"
                    ? "Conta precisa estar aprovada antes de virar padrão"
                    : isArchived
                      ? "Conta arquivada não pode ser ativada"
                      : undefined
              }
            >
              <Star className="h-4 w-4 mr-2" />
              {isActive ? "Já é a padrão" : "Definir como padrão"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={canArchive ? () => setConfirmArchive(true) : undefined}
              disabled={!canArchive}
              className={canArchive ? "text-red-600 focus:text-red-700" : undefined}
              title={
                isActive
                  ? "Não dá pra arquivar a conta ativa — selecione outra como padrão antes"
                  : isArchived
                    ? "Conta já arquivada"
                    : undefined
              }
            >
              <Archive className="h-4 w-4 mr-2" />
              {isArchived ? "Já arquivada" : "Excluir (arquivar)"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar nome da conta</DialogTitle>
            <DialogDescription>
              O nome aparece no seletor e no dashboard. Não afeta a conta na
              Asaas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`label-${accountId}`}>Nome</Label>
            <Input
              id={`label-${accountId}`}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Ex.: Imobiliária PJ, Holding..."
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancelar
            </Button>
            <Button onClick={rename} disabled={busy || newLabel.trim().length < 2}>
              {busy ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar esta conta?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela deixa de aparecer nos seletores. Cobranças e transferências
              antigas continuam acessíveis e pagáveis. Não dá pra arquivar a
              conta ativa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                archive();
              }}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700"
            >
              {busy ? "Arquivando..." : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
