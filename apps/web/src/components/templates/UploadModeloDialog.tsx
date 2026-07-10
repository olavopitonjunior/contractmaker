"use client";

import { useRef, useState } from "react";
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
import { FileUp, Loader2 } from "lucide-react";

const MODALIDADES = [
  { value: "locacao", label: "Locação residencial" },
  { value: "locacao_comercial", label: "Locação comercial" },
  { value: "administracao_locacao", label: "Administração de locação" },
  { value: "a_vista", label: "Venda à vista" },
  { value: "financiamento", label: "Venda com financiamento" },
];

/**
 * "Novo do modelo da imobiliária (DOCX)": sobe o documento timbrado da
 * imobiliária, a IA insere os {{placeholders}} e o operador revisa antes
 * de ativar. O contrato gerado fica idêntico ao modelo (engine google_docs).
 */
export function UploadModeloDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [modalidade, setModalidade] = useState("locacao");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Selecione o DOCX do modelo.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("modalidade", modalidade);
      if (name.trim()) fd.append("name", name.trim());
      const res = await fetch("/api/templates/from-docx", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha no upload");
      toast.success("Modelo importado — revise os placeholders antes de ativar.");
      setOpen(false);
      router.push(`/templates/${data.templateId}/review`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FileUp className="mr-1.5 h-4 w-4" />
          Importar modelo da imobiliária (.docx)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modelo da imobiliária → template</DialogTitle>
          <DialogDescription>
            Suba o DOCX timbrado. O layout (logo, fontes) é preservado; a IA
            insere os campos variáveis e você revisa antes de ativar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Arquivo (DOCX, até 20MB)</Label>
            <Input ref={fileRef} type="file" accept=".docx" />
          </div>
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
                Convertendo e mapeando campos…
              </>
            ) : (
              "Importar modelo"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
