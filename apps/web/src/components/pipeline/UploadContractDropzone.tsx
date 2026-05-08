"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp, FileText, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const ALLOWED_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
const ALLOWED_EXTS = [".pdf", ".docx"];
const MAX_BYTES = 20 * 1024 * 1024;

interface UploadContractDropzoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  /** Estado externo de upload — quando true, mostra spinner e bloqueia troca. */
  uploading?: boolean;
}

/**
 * Single-file dropzone para CCV externo. Diferente do DocumentosStep do form
 * (multi-file, multi-categoria), aqui aceitamos exatamente 1 arquivo PDF/DOCX
 * que vira o contrato a ser importado. Sem resize client-side — PDFs/DOCX
 * vão direto pro endpoint.
 */
export function UploadContractDropzone({
  onFileSelected,
  disabled,
  uploading,
}: UploadContractDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback((file: File): string | null => {
    const mimeOk = (ALLOWED_MIMES as readonly string[]).includes(file.type);
    const extOk = ALLOWED_EXTS.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );
    if (!mimeOk && !extOk) {
      return "Apenas PDF ou DOCX são aceitos.";
    }
    if (file.size > MAX_BYTES) {
      return `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo 20 MB.`;
    }
    if (file.size === 0) {
      return "Arquivo vazio.";
    }
    return null;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const err = validate(file);
      if (err) {
        setError(err);
        setSelected(null);
        return;
      }
      setError(null);
      setSelected(file);
      onFileSelected(file);
    },
    [onFileSelected, validate]
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Limpa input pra que selecionar o mesmo arquivo de novo dispare onChange
    e.target.value = "";
  }

  function clear() {
    setSelected(null);
    setError(null);
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => {
          if (!disabled && !uploading && !selected) inputRef.current?.click();
        }}
        className={[
          "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          disabled || uploading ? "opacity-60 pointer-events-none" : "cursor-pointer",
          selected ? "bg-muted/30" : "",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={onChange}
          disabled={disabled || uploading}
        />

        {!selected ? (
          <div className="flex flex-col items-center gap-2">
            <FileUp className="h-10 w-10 text-muted-foreground/60" />
            <p className="text-sm font-medium">
              Arraste o contrato aqui ou clique para selecionar
            </p>
            <p className="text-xs text-muted-foreground">
              PDF ou DOCX, até 20 MB
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-3 min-w-0">
              {uploading ? (
                <Loader2 className="h-8 w-8 text-primary shrink-0 animate-spin" />
              ) : (
                <FileText className="h-8 w-8 text-primary shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{selected.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(selected.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                  {selected.type.includes("pdf") ? "PDF" : "DOCX"}
                </p>
              </div>
            </div>
            {!uploading && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  clear();
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
