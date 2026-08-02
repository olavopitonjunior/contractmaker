"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileText, FileUp, Layers, Loader2 } from "lucide-react";

/** Rótulos PT-BR das categorias de KnowledgeItem (espelha KnowledgeBaseClient). */
const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Detectar automaticamente" },
  { value: "clause", label: "Cláusulas (Biblioteca)" },
  { value: "legislation", label: "Legislação" },
  { value: "model", label: "Modelos Referenciais" },
  { value: "rule", label: "Regras do Escritório" },
  { value: "glossary", label: "Glossário" },
];

type TemplateWarning = {
  file: File;
  reason: string;
  suggestion: string;
};

/**
 * Sobe um PDF/DOCX pra base de conhecimento (o servidor extrai o texto —
 * Gemini pra PDF, mammoth pra DOCX — e gera embeddings em background). Reusado
 * na página de configurações e no wizard de onboarding.
 *
 * Sem categoria escolhida, o servidor classifica o documento: contrato inteiro
 * volta 409 LOOKS_LIKE_TEMPLATE (tratado aqui com o diálogo abaixo) e coleção
 * de cláusulas vira N itens, um por cláusula.
 */
export function KnowledgeUploadCard({
  onDone,
  uploadUrl = "/api/knowledge/upload",
  platform = false,
}: {
  onDone?: () => void;
  /** Plataforma usa /api/admin/knowledge/upload (gate super_admin). */
  uploadUrl?: string;
  /** Na plataforma a categoria é OBRIGATÓRIA (a rota rejeita "auto"):
   *  quem cura a base universal sabe o que publica — adivinhar com LLM
   *  introduziria incerteza em conteúdo que não pode ter. */
  platform?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState(platform ? "legislation" : "");
  const [warning, setWarning] = useState<TemplateWarning | null>(null);
  const options = platform
    ? CATEGORY_OPTIONS.filter((o) => o.value !== "")
    : CATEGORY_OPTIONS;

  /** Um request. `force` ignora o 409 de "parece um modelo de contrato". */
  async function upload(file: File, force: boolean) {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (category) fd.append("category", category);
      if (force) fd.append("force", "true");
      const res = await fetch(uploadUrl, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data?.code === "LOOKS_LIKE_TEMPLATE") {
        setWarning({
          file,
          reason: String(data.reason ?? ""),
          suggestion: String(data.suggestion ?? ""),
        });
        return;
      }
      if (!res.ok) {
        toast.error(data.error || "Falha ao subir o documento.");
        return;
      }

      setWarning(null);
      const items = Number(data.items ?? 1);
      if (data.mode === "clauses" && items > 1) {
        toast.success(
          `"${data.title}" adicionado ao acervo — ${items} cláusulas separadas.`
        );
      } else {
        const chunks = Number(data.chunks ?? 1);
        toast.success(
          `"${data.title}" adicionado à base de conhecimento` +
            (chunks > 1 ? ` (${chunks} trechos).` : ".")
        );
      }
      onDone?.();
    } catch {
      toast.error("Falha ao subir o documento.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await upload(file, false);
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
      <select
        aria-label="Categoria do documento"
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={loading}
      >
        {options.map((opt) => (
          <option key={opt.value || "auto"} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
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
      {/* Atalho pra quem chegou aqui querendo mandar um MODELO: a central de
          ingestão aceita o lote inteiro (contratos + cláusulas), classifica e
          consolida. Este card continua existindo pra quem já sabe o que quer. */}
      <Button variant="ghost" size="sm" asChild disabled={loading}>
        <Link href="/templates?ingest=1">
          <Layers className="h-4 w-4 mr-1" />
          Enviar documentos da imobiliária
        </Link>
      </Button>

      <Dialog
        open={warning !== null}
        onOpenChange={(next) => {
          if (loading) return;
          if (!next) setWarning(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-600" />
              Isso parece um modelo de contrato
            </DialogTitle>
            <DialogDescription>
              {warning?.reason ||
                "O documento tem estrutura de contrato completo (partes, cláusulas e assinaturas)."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{warning?.suggestion}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1"
              disabled={loading}
              onClick={() => {
                setWarning(null);
                toast.info("Selecione o mesmo arquivo na central que vai abrir.");
                router.push("/templates?ingest=1");
              }}
            >
              Enviar como modelo
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              disabled={loading}
              onClick={() => {
                const pending = warning;
                if (!pending) return;
                setWarning(null);
                void upload(pending.file, true);
              }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Enviar pro acervo mesmo assim
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
