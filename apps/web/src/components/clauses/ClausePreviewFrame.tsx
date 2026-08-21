"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CLAUSE_PREVIEW_MODALIDADES } from "@/lib/clauses/schema";

// Lista canônica compartilhada com o enum da rota (lib/clauses/schema) —
// fork manual dessincronizava (faltavam locacao_comercial e temporada).
const MODALIDADE_OPTIONS = CLAUSE_PREVIEW_MODALIDADES;

export type PreviewModalidade = (typeof MODALIDADE_OPTIONS)[number]["value"];

interface ClausePreviewFrameProps {
  /** Handlebars-fonte a renderizar. POST /api/clauses/preview. */
  content: string;
  className?: string;
}

/**
 * Preview compartilhado por `ClauseDetailSheet` e `ClauseEditor` — o mesmo
 * mecanismo do preview de templates (`TemplatePreview`): renderiza no
 * servidor contra dados de amostra e exibe em `<iframe sandbox="">`, sem
 * `allow-scripts`. Erro de sintaxe Handlebars volta 422 e vira mensagem
 * inline — é o "linter" do editor.
 */
export function ClausePreviewFrame({ content, className }: ClausePreviewFrameProps) {
  const [modalidade, setModalidade] = useState<PreviewModalidade>("a_vista");
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalidadeRef = useRef(modalidade);
  modalidadeRef.current = modalidade;

  const generate = useCallback(async (target: PreviewModalidade, source: string) => {
    if (!source.trim()) {
      setError("Preencha o conteúdo da cláusula antes de gerar o preview.");
      setHtml(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clauses/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: source, modalidade: target }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Falha ao renderizar preview"
        );
        setHtml(null);
        return;
      }
      setHtml(typeof data.html === "string" ? data.html : "");
    } catch {
      setError("Erro de conexão ao gerar o preview.");
      setHtml(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Gera ao montar e sempre que o conteúdo-fonte mudar por fora (troca de
  // cláusula selecionada, ou volta pra aba de Preview no editor após editar).
  useEffect(() => {
    generate(modalidadeRef.current, content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, generate]);

  function selectModalidade(v: string) {
    const next = v as PreviewModalidade;
    if (next === modalidade) return;
    setModalidade(next);
    generate(next, content);
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <Select value={modalidade} onValueChange={selectModalidade}>
          <SelectTrigger size="sm" className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODALIDADE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => generate(modalidade, content)}
        >
          {loading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
          )}
          Atualizar
        </Button>
      </div>

      <div className="min-h-0 flex-1 rounded border bg-muted/30">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">
            {error}
          </div>
        ) : loading || html == null ? (
          <div className="h-full space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <iframe
            // sandbox vazio = sem scripts e sem mesma origem — mesmo padrão do
            // preview de templates.
            sandbox=""
            srcDoc={wrapDocument(html)}
            className="h-full w-full rounded bg-white"
            title="Preview da cláusula"
          />
        )}
      </div>
    </div>
  );
}

/** Envelope mínimo pra fragmento HTML sem `<html>` completo. */
function wrapDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font-family:'EB Garamond',Georgia,serif;color:#111;line-height:1.55;}</style></head><body>${html}</body></html>`;
}
