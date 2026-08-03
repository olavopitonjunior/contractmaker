"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// 20MB: client-direct pro Blob (blob-upload + finalize), então não passa pelo
// corpo da função e o teto de ~4,5MB da Vercel não vale.
const MAX_BYTES = 20 * 1024 * 1024;

interface ProposalAttachmentUploadProps {
  proposalId: string;
  /** Categoria gravada no ProposalAttachment. */
  category?: string;
  label: string;
  /** Chamado após o upload. Tipicamente router.refresh(). */
  onUploaded: () => void;
}

/**
 * Botão de anexo da proposta. Existe sobretudo pro **Registro do Aceite** da
 * ClickSign: o documento com as provas de identidade e as mensagens trocadas,
 * que a ClickSign gera mas só entrega pela interface web (a API v3 não expõe
 * link de download). Sem isto, o único artefato do Aceite era o comprovante que
 * nós mesmos montamos.
 */
export function ProposalAttachmentUpload({
  proposalId,
  category,
  label,
  onUploaded,
}: ProposalAttachmentUploadProps) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name} excede 20 MB`);
      return;
    }
    setBusy(true);
    try {
      const mime = file.type || "application/octet-stream";
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blob = await upload(
        `proposal-attachments/${proposalId}/${Date.now()}-${safeName}`,
        file,
        {
          access: "public",
          contentType: mime,
          handleUploadUrl: `/api/proposals/${proposalId}/attachments/blob-upload`,
        }
      );

      const res = await fetch(`/api/proposals/${proposalId}/attachments/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blob.url, filename: file.name, mime, category }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(d?.error || "Falha ao anexar");
        return;
      }
      const d = await res.json().catch(() => null);
      toast.success(d?.deduped ? "Este arquivo já estava anexado." : "Documento anexado.");
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-1.5 h-4 w-4" />
        {busy ? "Enviando…" : label}
      </Button>
    </>
  );
}
