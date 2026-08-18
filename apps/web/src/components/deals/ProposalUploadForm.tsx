"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { UploadContractDropzone } from "@/components/pipeline/UploadContractDropzone";
import { ManagerSelect } from "@/components/deals/ManagerSelect";

/**
 * Formulário "Cadastro com proposta" por upload de PDF (extração via IA).
 * Extraído das páginas `/deals/new-from-proposal` e
 * `/locacao/deals/new-from-proposal` pra também viver dentro do diálogo do
 * dropdown "Novo negócio" (aba "Anexar PDF de fora") — um só comportamento,
 * três pontos de uso.
 */
export function ProposalUploadForm({ kind }: { kind: "venda" | "locacao" }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [finalidade, setFinalidade] = useState<"residencial" | "comercial">(
    "residencial"
  );
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Gerente responsável pelo negócio (obrigatório quando a org liga o toggle).
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const [managerRequired, setManagerRequired] = useState(false);

  async function handleSubmit() {
    if (!file) {
      toast.error("Selecione um PDF da proposta.");
      return;
    }
    // Gemini não parseia DOCX nativamente (recebe bytes ZIP brutos).
    // Bloqueio aqui evita má UX "subi DOCX e nada veio preenchido".
    if (file.type !== "application/pdf") {
      toast.error("Por ora só PDF funciona aqui. Exporte como PDF e tente de novo.");
      return;
    }
    if (managerRequired && !managerUserId) {
      toast.error("Selecione o gerente responsável");
      return;
    }
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    if (kind === "locacao") formData.append("finalidade", finalidade);
    if (title.trim()) formData.append("title", title.trim());
    if (managerUserId) formData.append("managerUserId", managerUserId);

    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const endpoint =
        kind === "locacao"
          ? "/api/locacao/deals/new-from-proposal"
          : "/api/deals/new-from-proposal";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        // Fallback do gate server-side (org exige gerente e o client não sabia).
        if (res.status === 422 && data?.error === "gerente_obrigatorio") {
          setManagerRequired(true);
          toast.error(data.message || "Selecione o gerente responsável");
        } else {
          toast.error(data.error || "Falha ao processar proposta.");
        }
        setUploading(false);
        if (data.formToken) {
          // Mesmo em erro parcial (storage falhou após criar form), abre o
          // form pro usuário começar do que foi extraído.
          router.push(`${data.formUrl ?? `/f/${data.formToken}`}?prefilled=1`);
        }
        return;
      }

      toast.success("Dados extraídos. Revise antes de gerar o contrato.");
      router.push(`${data.formUrl ?? `/f/${data.formToken}`}?prefilled=1`);
    } catch (err) {
      console.error(err);
      toast.error("Erro de rede ao enviar o arquivo. Tente novamente.");
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="proposal-upload-title">Título do negócio (opcional)</Label>
        <Input
          id="proposal-upload-title"
          placeholder={
            kind === "locacao"
              ? "Ex: Locação Apto 302 - Ed. Floresta"
              : "Ex: Proposta Apto 302 - Ed. Floresta"
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={uploading}
        />
        <p className="text-xs text-muted-foreground">
          Se deixar em branco, vamos usar o nome do arquivo da proposta.
        </p>
      </div>

      {kind === "locacao" && (
        <div className="space-y-2">
          <Label>Finalidade</Label>
          <NativeSelect
            value={finalidade}
            onChange={(v) => setFinalidade(v as "residencial" | "comercial")}
            options={[
              { value: "residencial", label: "Residencial" },
              { value: "comercial", label: "Comercial" },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            A IA também detecta pela proposta — sua escolha vale quando a
            extração não conseguir decidir.
          </p>
        </div>
      )}

      <ManagerSelect
        value={managerUserId}
        onChange={setManagerUserId}
        disabled={uploading}
        onContextLoaded={(ctx) => setManagerRequired(ctx.managerRequired)}
      />

      <div className="space-y-2">
        <Label>Proposta</Label>
        <UploadContractDropzone onFileSelected={setFile} uploading={uploading} />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!file || uploading}
        className="w-full"
        size="lg"
      >
        {uploading
          ? "Extraindo dados da proposta..."
          : "Extrair dados e abrir formulário"}
      </Button>
    </div>
  );
}
