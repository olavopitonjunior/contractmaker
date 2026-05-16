"use client";

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GoogleDocsEditorProps {
  googleDocId: string;
  googleDocUrl?: string | null;
  readOnly?: boolean;
  status?: string;
}

/**
 * Wrapper de iframe para o editor Google Docs. Cobre o caminho de UI quando
 * o contrato vive como Google Doc (ver schema: Contract.googleDocId).
 *
 * Limitações conhecidas (vs. TipTap atual):
 *  - Não há `applyCommentMarkByText` no iframe — comentários da IA viajam
 *    pelo Drive Comments API (Phase 4).
 *  - BubbleMenu, find/replace custom e atalhos próprios são substituídos pelos
 *    nativos do Google Docs.
 *  - Para iframe carregar com permissão, o usuário precisa estar logado em
 *    uma conta Google que tenha acesso ao doc (ou doc compartilhado como
 *    "anyone with link, can edit").
 */
export function GoogleDocsEditor({
  googleDocId,
  googleDocUrl,
  readOnly,
  status,
}: GoogleDocsEditorProps) {
  const embedSrc = useMemo(() => {
    const base = `https://docs.google.com/document/d/${googleDocId}/${
      readOnly ? "preview" : "edit"
    }`;
    const params = new URLSearchParams({
      embedded: "true",
      rm: "embedded",
    });
    return `${base}?${params.toString()}`;
  }, [googleDocId, readOnly]);

  const externalUrl =
    googleDocUrl || `https://docs.google.com/document/d/${googleDocId}/edit`;

  return (
    <div
      className="flex flex-col bg-muted/40"
      data-status={status === "aprovado" ? "aprovado" : "rascunho"}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-card">
        <div className="text-xs text-muted-foreground">
          {readOnly
            ? "Visualização — contrato aprovado e somente leitura"
            : "Edição via Google Docs · sem necessidade de login Google (autor aparece como anônimo no histórico do Drive)"}
        </div>
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <a href={externalUrl} target="_blank" rel="noopener noreferrer">
            Abrir no Google Docs
            <ExternalLink className="ml-1 h-3 w-3" />
          </a>
        </Button>
      </div>
      <iframe
        title="Google Docs Editor"
        src={embedSrc}
        className="w-full"
        style={{ height: "calc(100vh - 220px)", minHeight: 600, border: 0 }}
        // sandbox limitado: precisa scripts + same-origin para Google Auth
        // funcionar; cookies de terceiros são exigidos pelo iframe Google.
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
