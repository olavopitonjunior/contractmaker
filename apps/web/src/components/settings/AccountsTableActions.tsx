"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreVertical, Star, Edit, Archive, Loader2 } from "lucide-react";

interface Props {
  accountId: string;
  label: string | null;
  status: string;
  isActive: boolean;
  isArchived: boolean;
}

/**
 * Dropdown de ações por conta — somente owner renderiza este componente
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
  const [newLabel, setNewLabel] = useState(label ?? "");

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
      toast.success("Conta agora é a ativa da organização");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (
      !confirm(
        "Arquivar esta conta? Ela não aparecerá mais nos seletores. Cobranças e transferências antigas continuam acessíveis."
      )
    ) {
      return;
    }
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isActive && status === "APPROVED" && !isArchived && (
            <DropdownMenuItem onClick={activate}>
              <Star className="h-4 w-4 mr-2" />
              Tornar ativa
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Edit className="h-4 w-4 mr-2" />
            Editar rótulo
          </DropdownMenuItem>
          {!isActive && !isArchived && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={archive}
                className="text-red-600 focus:text-red-700"
              >
                <Archive className="h-4 w-4 mr-2" />
                Arquivar
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar rótulo da conta</DialogTitle>
            <DialogDescription>
              O rótulo aparece no seletor e no dashboard. Não afeta a conta na
              Asaas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="label">Rótulo</Label>
            <Input
              id="label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Ex.: Imobiliária PJ, Holding..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancelar
            </Button>
            <Button onClick={rename} disabled={busy || newLabel.trim().length < 2}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
