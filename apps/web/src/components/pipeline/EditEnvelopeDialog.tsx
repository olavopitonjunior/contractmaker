"use client";

import { useEffect, useState } from "react";
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
import { Save } from "lucide-react";
import type { EnvelopeRow } from "@/hooks/useEnvelopePolling";

interface EditEnvelopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  envelope: EnvelopeRow;
  onSaved: () => void;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const offsetMs = d.getTimezoneOffset() * 60_000;
  const local = new Date(d.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

export function EditEnvelopeDialog({
  open,
  onOpenChange,
  contractId,
  envelope,
  onSaved,
}: EditEnvelopeDialogProps) {
  const [name, setName] = useState(envelope.name);
  const [deadlineLocal, setDeadlineLocal] = useState(
    toLocalInputValue(envelope.deadlineAt)
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(envelope.name);
      setDeadlineLocal(toLocalInputValue(envelope.deadlineAt));
      setSubmitting(false);
    }
  }, [open, envelope]);

  const nameLocked = envelope.status === "running";

  const handleSubmit = async () => {
    if (!nameLocked && (!name.trim() || name.trim().length < 1)) {
      toast.error("Nome obrigatório");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {};
      if (!nameLocked && name.trim() !== envelope.name) {
        body.name = name.trim();
      }
      const currentDeadline = envelope.deadlineAt
        ? new Date(envelope.deadlineAt).toISOString()
        : null;
      const newDeadline = deadlineLocal
        ? new Date(deadlineLocal).toISOString()
        : null;
      if (newDeadline !== currentDeadline) {
        body.deadlineAt = newDeadline;
      }

      if (Object.keys(body).length === 0) {
        toast.info("Nenhuma alteração");
        onOpenChange(false);
        return;
      }

      const res = await fetch(
        `/api/contracts/${contractId}/envelopes/${envelope.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const respBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(respBody.error || `HTTP ${res.status}`);
      }
      toast.success("Envelope atualizado");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar envelope</DialogTitle>
          <DialogDescription>
            {nameLocked
              ? "Envelope em andamento — apenas o prazo pode ser alterado."
              : "Atualiza nome e prazo na Clicksign."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="env-name">Nome</Label>
            <Input
              id="env-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting || nameLocked}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="env-deadline">
              Prazo (opcional, fuso local)
            </Label>
            <Input
              id="env-deadline"
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
              disabled={submitting}
            />
            {deadlineLocal && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => setDeadlineLocal("")}
                disabled={submitting}
              >
                Remover prazo
              </button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            <Save className="h-4 w-4 mr-2" />
            {submitting ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
