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
import type { EnvelopeSignerRow } from "@/hooks/useEnvelopePolling";

interface EditSignerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  envelopeId: string;
  signer: EnvelopeSignerRow;
  onSaved: () => void;
}

function maskCpfCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function EditSignerDialog({
  open,
  onOpenChange,
  contractId,
  envelopeId,
  signer,
  onSaved,
}: EditSignerDialogProps) {
  const [name, setName] = useState(signer.name);
  const [email, setEmail] = useState(signer.email);
  const [documentation, setDocumentation] = useState(signer.documentation || "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(signer.name);
      setEmail(signer.email);
      setDocumentation(signer.documentation || "");
      setSubmitting(false);
    }
  }, [open, signer]);

  const handleSubmit = async () => {
    if (!name.trim() || name.trim().length < 2) {
      toast.error("Nome inválido");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("E-mail inválido");
      return;
    }

    const docDigits = documentation.replace(/\D/g, "");
    if (docDigits && docDigits.length !== 11 && docDigits.length !== 14) {
      toast.error("CPF deve ter 11 dígitos ou CNPJ 14");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { action: "update" };
      if (name.trim() !== signer.name) body.name = name.trim();
      if (email.trim() !== signer.email) body.email = email.trim();
      if (docDigits !== (signer.documentation || "")) {
        body.documentation = docDigits;
      }

      if (Object.keys(body).length === 1) {
        toast.info("Nenhuma alteração");
        onOpenChange(false);
        return;
      }

      const res = await fetch(
        `/api/contracts/${contractId}/envelopes/${envelopeId}/signers/${signer.id}`,
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
      toast.success("Signatário atualizado");
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
          <DialogTitle>Editar signatário</DialogTitle>
          <DialogDescription>
            Atualiza os dados na Clicksign e reflette no banco. Use quando o
            e-mail estiver errado ou faltar CPF.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="signer-name">Nome</Label>
            <Input
              id="signer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signer-email">E-mail</Label>
            <Input
              id="signer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signer-doc">CPF/CNPJ (opcional)</Label>
            <Input
              id="signer-doc"
              value={maskCpfCnpj(documentation)}
              onChange={(e) =>
                setDocumentation(e.target.value.replace(/\D/g, ""))
              }
              placeholder="000.000.000-00"
              disabled={submitting}
            />
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
