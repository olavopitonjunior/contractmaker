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
import { NativeSelect } from "@/components/forms/NativeSelect";
import { UserPlus } from "lucide-react";
import { CLICKSIGN_ROLE_OPTIONS, type ClicksignRole } from "@/lib/clicksign/roles";

interface AddSignerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Base do envelope (`/api/.../envelopes/{eid}`); POST em `${basePath}/signers`. */
  basePath: string;
  onAdded: () => void;
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

export function AddSignerDialog({
  open,
  onOpenChange,
  basePath,
  onAdded,
}: AddSignerDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [documentation, setDocumentation] = useState("");
  const [role, setRole] = useState<ClicksignRole>("sign");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setDocumentation("");
      setRole("sign");
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (name.trim().length < 2) {
      toast.error("Nome inválido");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
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
      const res = await fetch(`${basePath}/signers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          documentation: docDigits || undefined,
          role,
          sourceKind: "outro",
          sourceIndex: 0,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success("Signatário adicionado (custo: R$ 1,50)");
      onAdded();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar signatário</DialogTitle>
          <DialogDescription>
            Inclui um novo signatário no envelope. Custo adicional de R$ 1,50.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="add-signer-name">Nome</Label>
            <Input
              id="add-signer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder="Nome completo"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-signer-email">E-mail</Label>
            <Input
              id="add-signer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              placeholder="email@exemplo.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-signer-doc">CPF/CNPJ (opcional)</Label>
            <Input
              id="add-signer-doc"
              value={maskCpfCnpj(documentation)}
              onChange={(e) => setDocumentation(e.target.value.replace(/\D/g, ""))}
              placeholder="000.000.000-00"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Assina como</Label>
            <NativeSelect
              value={role}
              onChange={(v) => setRole(v as ClicksignRole)}
              options={CLICKSIGN_ROLE_OPTIONS}
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
            <UserPlus className="h-4 w-4 mr-2" />
            {submitting ? "Adicionando..." : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
