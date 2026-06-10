"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LayoutTemplate, Loader2 } from "lucide-react";

const MODALIDADES = [
  { value: "locacao", label: "Locação residencial" },
  { value: "locacao_comercial", label: "Locação comercial" },
  { value: "a_vista", label: "Venda à vista" },
  { value: "financiamento", label: "Venda com financiamento" },
];

/**
 * "Tornar modelo da imobiliária": copia o Google Doc deste contrato como
 * master de um novo template (engine google_docs), converte os dados
 * preenchidos em {{placeholders}} (reverse-merge + IA) e abre a revisão.
 * O contrato original fica intacto.
 */
export function PromoteToTemplateDialog({
  contractId,
  defaultModalidade = "locacao",
}: {
  contractId: string;
  defaultModalidade?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [modalidade, setModalidade] = useState(defaultModalidade);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/templates/from-contract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractId,
          modalidade,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao criar modelo");
      toast.success("Modelo criado — revise os placeholders antes de ativar.");
      setOpen(false);
      router.push(`/templates/${data.templateId}/review`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar modelo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LayoutTemplate className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Tornar modelo</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tornar modelo da imobiliária</DialogTitle>
          <DialogDescription>
            Este contrato vira o documento-padrão da imobiliária: os dados
            preenchidos são convertidos em campos variáveis e você revisa
            antes de ativar. O contrato original não é alterado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Modalidade</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={modalidade}
              onChange={(e) => setModalidade(e.target.value)}
            >
              {MODALIDADES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Nome do template (opcional)</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Locação residencial — padrão da casa"
            />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Copiando e convertendo…
              </>
            ) : (
              "Criar modelo"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
