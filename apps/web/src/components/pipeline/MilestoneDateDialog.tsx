"use client";

import { useEffect, useState } from "react";
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

interface MilestoneDateDialogProps {
  open: boolean;
  /** Texto do marco, ex: "assinatura do contrato". */
  milestoneLabel: string;
  onConfirm: (isoDate: string) => void;
  onCancel: () => void;
}

function todayInputValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Pede a data de um marco do funil quando o card é arrastado para o stage e a
 * etapa NÃO foi feita no sistema (sem envelope/charge). Âncora meio-dia local
 * no parse pra evitar drift de fuso (UTC-3 escorregaria pro dia anterior).
 */
export function MilestoneDateDialog({
  open,
  milestoneLabel,
  onConfirm,
  onCancel,
}: MilestoneDateDialogProps) {
  const [value, setValue] = useState(todayInputValue());

  useEffect(() => {
    if (open) setValue(todayInputValue());
  }, [open]);

  function handleConfirm() {
    if (!value) return;
    const [y, m, d] = value.split("-").map(Number);
    if (!y || !m || !d) return;
    const iso = new Date(y, m - 1, d, 12, 0, 0).toISOString();
    onConfirm(iso);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Qual a data de {milestoneLabel}?</DialogTitle>
          <DialogDescription>
            Esta etapa não foi feita pelo sistema. Informe a data para registrar
            o marco na linha do tempo do negócio.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="milestone-date">Data</Label>
          <Input
            id="milestone-date"
            type="date"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!value}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
