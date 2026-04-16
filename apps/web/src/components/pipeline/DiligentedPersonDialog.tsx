"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";

export interface DiligentedPersonInput {
  tipoPessoa: "fisica" | "juridica";
  nome: string;
  cpf?: string | null;
  cnpj?: string | null;
  dataNascimento?: string | null;
  uf?: string | null;
  cidade?: string | null;
  relacao?: string | null;
  notes?: string | null;
}

interface Props {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const UF_OPTIONS = [
  { value: "", label: "— Selecionar —" },
  { value: "SP", label: "SP" },
  { value: "RJ", label: "RJ" },
  { value: "RS", label: "RS" },
  { value: "MG", label: "MG" },
  { value: "PR", label: "PR" },
  { value: "SC", label: "SC" },
  { value: "BA", label: "BA" },
  { value: "DF", label: "DF" },
  { value: "OUTRO", label: "Outro" },
];

const RELACAO_OPTIONS = [
  { value: "socio", label: "Sócio" },
  { value: "avalista", label: "Avalista / Fiador" },
  { value: "procurador", label: "Procurador" },
  { value: "conjuge", label: "Cônjuge" },
  { value: "outro", label: "Outro" },
];

export function DiligentedPersonDialog({
  dealId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [tipoPessoa, setTipoPessoa] = useState<"fisica" | "juridica">("fisica");
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [uf, setUf] = useState("");
  const [cidade, setCidade] = useState("");
  const [relacao, setRelacao] = useState("socio");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTipoPessoa("fisica");
    setNome("");
    setCpf("");
    setCnpj("");
    setDataNascimento("");
    setUf("");
    setCidade("");
    setRelacao("socio");
    setNotes("");
  };

  const handleSubmit = async () => {
    if (!nome.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (tipoPessoa === "fisica" && !cpf.trim()) {
      toast.error("CPF é obrigatório para pessoa física");
      return;
    }
    if (tipoPessoa === "juridica" && !cnpj.trim()) {
      toast.error("CNPJ é obrigatório para pessoa jurídica");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/diligenciados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoPessoa,
          nome: nome.trim(),
          cpf: tipoPessoa === "fisica" ? cpf : null,
          cnpj: tipoPessoa === "juridica" ? cnpj : null,
          dataNascimento: dataNascimento || null,
          uf: uf && uf !== "OUTRO" ? uf : null,
          cidade: cidade.trim() || null,
          relacao: relacao || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Erro ao criar pessoa diligenciada");
        return;
      }
      toast.success("Pessoa adicionada à due diligence");
      reset();
      onOpenChange(false);
      onCreated?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Adicionar pessoa diligenciada
          </DialogTitle>
          <DialogDescription>
            Pessoas externas ao contrato (sócios de empresa, avalistas, procuradores)
            cujas certidões serão extraídas sem entrar nas partes do contrato.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Tipo de pessoa</Label>
            <NativeSelect
              value={tipoPessoa}
              onChange={(v) => setTipoPessoa(v as "fisica" | "juridica")}
              options={[
                { value: "fisica", label: "Física" },
                { value: "juridica", label: "Jurídica" },
              ]}
              className="h-9"
            />
          </div>

          <div>
            <Label className="text-xs">Nome completo / Razão social *</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="h-9"
              placeholder="Ex: João da Silva"
            />
          </div>

          {tipoPessoa === "fisica" ? (
            <>
              <div>
                <Label className="text-xs">CPF *</Label>
                <Input
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  className="h-9"
                  placeholder="000.000.000-00"
                />
              </div>
              <div>
                <Label className="text-xs">Data de nascimento (PGFN exige)</Label>
                <Input
                  type="date"
                  value={dataNascimento}
                  onChange={(e) => setDataNascimento(e.target.value)}
                  className="h-9"
                />
              </div>
            </>
          ) : (
            <div>
              <Label className="text-xs">CNPJ *</Label>
              <Input
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                className="h-9"
                placeholder="00.000.000/0000-00"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">UF</Label>
              <NativeSelect
                value={uf}
                onChange={setUf}
                options={UF_OPTIONS}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Cidade</Label>
              <Input
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Relação</Label>
            <NativeSelect
              value={relacao}
              onChange={setRelacao}
              options={RELACAO_OPTIONS}
              className="h-9"
            />
          </div>

          <div>
            <Label className="text-xs">Observações</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9"
              placeholder="Ex: Sócio 50% da empresa X"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Adicionando…
              </>
            ) : (
              "Adicionar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
