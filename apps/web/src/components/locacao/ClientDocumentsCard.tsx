"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Trash2, Upload } from "lucide-react";

export interface ClientDocRow {
  id: string;
  filename: string;
  category: string | null;
  createdAt: string;
}

export function ClientDocumentsCard({
  clientId,
  documents,
}: {
  clientId: string;
  documents: ClientDocRow[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/locacao/clients/${clientId}/attachments`, {
        method: "POST",
        body: fd,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success(d.deduped ? "Documento já existia (dedupe)" : "Documento enviado");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDelete(attachmentId: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/locacao/clients/${clientId}/attachments?attachmentId=${attachmentId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" /> Documentos
        </CardTitle>
        <>
          <input ref={inputRef} type="file" className="hidden" onChange={onUpload} disabled={busy} />
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4 mr-1.5" />
            {busy ? "Enviando…" : "Enviar documento"}
          </Button>
        </>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum documento. Anexe RG, comprovante de renda, etc. PDFs de consultas Serasa aparecem
            aqui automaticamente.
          </p>
        ) : (
          <ul className="divide-y">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 py-2">
                <a
                  href={`/api/locacao/clients/${clientId}/attachments/${doc.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2 hover:underline"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm">{doc.filename}</span>
                  {doc.category && (
                    <span className="shrink-0 text-xs text-muted-foreground">({doc.category})</span>
                  )}
                </a>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => onDelete(doc.id)}
                  disabled={busy}
                  title="Excluir documento"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
