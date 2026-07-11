"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";

/**
 * Sobe um PDF/DOCX pra base de conhecimento (o servidor extrai o texto —
 * Gemini pra PDF, mammoth pra DOCX — e gera embeddings em background). Reusado
 * na página de configurações e no wizard de onboarding.
 */
export function KnowledgeUploadCard({ onDone }: { onDone?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/knowledge/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao subir o documento.");
        return;
      }
      toast.success(`"${data.title}" adicionado à base de conhecimento.`);
      onDone?.();
    } catch {
      toast.error("Falha ao subir o documento.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx"
        className="hidden"
        onChange={onPick}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <FileUp className="h-4 w-4 mr-1" />
        )}
        Subir PDF/DOCX
      </Button>
    </>
  );
}
