"use client";

import { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";

const MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 3;

interface AddDocumentsCardProps {
  dealId: string;
  /** Chamado após o lote terminar (sucesso parcial ou total). Tipicamente router.refresh(). */
  onUploaded: () => void;
}

/** pLimit minimalista — no máximo `concurrency` tarefas async simultâneas. */
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return <T,>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(
          (v) => {
            resolve(v);
            next();
          },
          (e) => {
            reject(e);
            next();
          }
        );
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

/**
 * Card de upload da aba Documentos do deal. Aceita QUALQUER tipo de arquivo
 * (armazenamento) até 10MB. Sobe o arquivo DIRETO pro Vercel Blob
 * (@vercel/blob/client `upload()` + handshake em `/attachments/blob-upload`),
 * contornando o limite de 4.5MB de corpo de função serverless da Vercel — antes
 * o upload base64-JSON falhava com "falha no upload" em arquivos > ~3.3MB. Em
 * seguida registra o anexo via `/attachments/finalize`. OCR/assinatura são
 * oferecidos depois, por card, conforme o tipo.
 */
export function AddDocumentsCard({ dealId, onUploaded }: AddDocumentsCardProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;

      const valid = arr.filter((f) => {
        if (f.size > MAX_BYTES) {
          toast.error(`${f.name} excede 10 MB`);
          return false;
        }
        return true;
      });
      if (valid.length === 0) return;

      setUploading(true);
      setProgress({ done: 0, total: valid.length });
      const limit = pLimit(UPLOAD_CONCURRENCY);
      let okCount = 0;

      const uploadOne = async (file: File) => {
        try {
          const mime = file.type || "application/octet-stream";
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          // 1. Upload client-direct pro Blob (sem passar bytes pela função →
          //    sem o limite de 4.5MB). O handshake valida auth/cross-org.
          const blob = await upload(
            `deal-attachments/${dealId}/${Date.now()}-${safeName}`,
            file,
            {
              access: "public",
              contentType: mime,
              handleUploadUrl: `/api/deals/${dealId}/attachments/blob-upload`,
            }
          );

          // 2. Registra o DealAttachment (body só metadados).
          const res = await fetch(`/api/deals/${dealId}/attachments/finalize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: blob.url, filename: file.name, mime }),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => null);
            toast.error(`${file.name}: ${d?.error || "falha no upload"}`);
            return;
          }
          okCount++;
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : "erro"}`);
        } finally {
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
      };

      await Promise.allSettled(valid.map((f) => limit(() => uploadOne(f))));

      setUploading(false);
      setProgress(null);
      if (okCount > 0) {
        toast.success(
          `${okCount} documento(s) adicionado(s)${okCount < valid.length ? ` de ${valid.length}` : ""}`
        );
        onUploaded();
      }
    },
    [dealId, onUploaded]
  );

  return (
    <Card className="border-dashed">
      <CardContent className="pt-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!uploading) handleFiles(e.dataTransfer.files);
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-7 transition-colors ${
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {uploading && progress
              ? `Enviando ${progress.done}/${progress.total}…`
              : "Clique ou arraste arquivos aqui"}
          </p>
          <p className="text-xs text-muted-foreground">
            Qualquer arquivo até 10 MB. PDFs e imagens podem ser lidos pela IA.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
