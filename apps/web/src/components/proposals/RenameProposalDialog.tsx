"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/**
 * Renomeia a proposta via `PATCH /api/proposals/[id]/title`.
 *
 * Serve a lista (menu da linha) e o detalhe (lápis no cabeçalho) — por isso o
 * refresh é `router.refresh()` e não um callback de estado local: os dois lugares
 * são server components e reidratam com o título novo.
 */
export function RenameProposalDialog({
  open,
  onOpenChange,
  proposalId,
  currentTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  currentTitle: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(currentTitle);
  const [busy, setBusy] = useState(false);

  // Reabrir o diálogo (ou trocar de linha na lista) precisa recarregar o valor —
  // senão o input guarda o rascunho abandonado da vez anterior.
  useEffect(() => {
    if (open) setTitle(currentTitle);
  }, [open, currentTitle]);

  const trimmed = title.trim();
  const canSave = trimmed.length > 0 && trimmed !== currentTitle && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success("Proposta renomeada.");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível renomear.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renomear proposta</DialogTitle>
          <DialogDescription>
            O título é só o rótulo interno — não altera o documento nem o envelope já
            enviado para assinatura.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="rename-proposal-title">Título</Label>
          <Input
            id="rename-proposal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            maxLength={200}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
