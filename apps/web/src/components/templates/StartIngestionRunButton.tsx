"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 20 * 1024 * 1024;
/** Mesmo teto do intake (`POST /api/templates/ingest/runs`). */
const MAX_FILES = 200;

/**
 * Ponto de partida do lote: sobe os arquivos direto pro Blob, abre o
 * `IngestionRun` e leva o operador pra tela de conferência.
 *
 * O upload é client-direct porque o corpo de uma função serverless da Vercel
 * para em ~4.5MB e um acervo são dezenas de DOCX de até 20MB — o handshake em
 * `/runs/blob-upload` só emite o token. Depois disso, quem toca o lote é o
 * servidor: fechar a aba não perde o trabalho, que era exatamente o defeito da
 * orquestração no navegador.
 */
export function StartIngestionRunButton({
  orgId,
  trigger = "central",
  label = "Envie seus modelos de uma vez",
  variant = "default",
}: {
  /** Prefixo do Blob desta imobiliária — o handshake recusa qualquer outro. */
  orgId: string;
  trigger?: "central" | "onboarding";
  label?: string;
  variant?: "default" | "outline" | "secondary";
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function start(files: File[]) {
    if (files.length === 0) return;
    if (files.length > MAX_FILES) {
      toast.error(`Envie no máximo ${MAX_FILES} arquivos por lote.`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      toast.error(`"${tooBig.name}" passa de 20MB — envie um arquivo menor.`);
      return;
    }

    setBusy(true);
    try {
      const uploaded: Array<{
        filename: string;
        blobUrl: string;
        fileKind: "docx" | "pdf";
        sourceHash: string;
        size: number;
      }> = [];

      for (const [index, file] of files.entries()) {
        setProgress(`Enviando ${index + 1} de ${files.length}…`);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const blob = await upload(`ingestion/${orgId}/${Date.now()}-${safeName}`, file, {
          access: "public",
          handleUploadUrl: "/api/templates/ingest/runs/blob-upload",
          contentType: file.type || "application/octet-stream",
        });
        uploaded.push({
          filename: file.name,
          blobUrl: blob.url,
          fileKind: isPdf(file) ? "pdf" : "docx",
          // O hash sai do navegador (que tem o arquivo em mãos) e governa só o
          // descarte SUGERIDO; a extração recalcula sobre os bytes lidos pelo
          // servidor, e é esse valor que decide duplicata de verdade.
          sourceHash: await sha256Hex(file),
          size: file.size,
        });
      }

      setProgress("Abrindo o lote…");
      const res = await fetch("/api/templates/ingest/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger, files: uploaded }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Falha ao abrir o lote");

      router.push(`/templates/ingestion/${data.runId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar os arquivos");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.pdf"
        multiple
        className="hidden"
        onChange={(e) => void start(Array.from(e.target.files ?? []))}
      />
      <Button
        variant={variant}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <FileUp className="mr-1.5 h-4 w-4" />
        )}
        {progress ?? label}
      </Button>
    </>
  );
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** SHA-256 hex do arquivo — mesma identidade de `ContractTemplate.sourceHash`. */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
