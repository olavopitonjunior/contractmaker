"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import { stripActiveContent } from "@/lib/proposals/preview-html";

/**
 * Janela do DOCUMENTO da proposta — a mesma pros dois estados, com rótulo
 * distinto:
 *
 *  - editável  → PREVIEW renderizado agora (POST .../preview). Pode mudar até o
 *    envio, e o rótulo diz isso.
 *  - enviada   → `sentSnapshotHtml`, o documento congelado no envio. É o que a
 *    pessoa assinou/aceitou; nada aqui re-renderiza.
 *
 * O HTML vem de template Handlebars compilado com `noEscape` (valores do
 * dataJson entram crus), então roda em `<iframe sandbox>` SEM `allow-scripts` e
 * SEM `allow-same-origin`, sobre markup já passado por `stripActiveContent`.
 */
export function ProposalDocumentCard({
  proposalId,
  editable,
  snapshotHtml,
}: {
  proposalId: string;
  editable: boolean;
  snapshotHtml: string | null;
}) {
  const [html, setHtml] = useState<string | null>(
    editable ? null : snapshotHtml ? stripActiveContent(snapshotHtml) : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/preview`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      if (!d.html) {
        setError(
          "Nenhum modelo de proposta ativo para este tipo. Ative um em Configurações › Modelos."
        );
        setHtml(null);
        return;
      }
      setHtml(d.html as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o preview.");
      setHtml(null);
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    if (editable) void loadPreview();
  }, [editable, loadPreview]);

  // Documento vazio (proposta sem snapshot e sem template) — não vale um card.
  if (!editable && !snapshotHtml) return null;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Documento</h2>
          <Badge
            variant="outline"
            className={
              editable
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }
          >
            {editable ? "Preview — pode mudar até o envio" : "Documento enviado"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {editable && (
            <Button variant="outline" size="sm" onClick={loadPreview} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          )}
          {html && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
              {expanded ? (
                <Minimize2 className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              {expanded ? "Reduzir" : "Ampliar"}
            </Button>
          )}
        </div>
      </div>

      {loading && !html && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Gerando o documento…
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {html && (
        <iframe
          title={editable ? "Preview da proposta" : "Documento enviado"}
          // sandbox vazio = tudo bloqueado (scripts, formulários, mesma origem).
          sandbox=""
          srcDoc={wrapDocument(html)}
          className={`w-full rounded-md border bg-white transition-[height] ${
            expanded ? "h-[85vh]" : "h-[420px]"
          }`}
        />
      )}
    </Card>
  );
}

/** Envelope mínimo só quando o render não trouxe documento completo. */
function wrapDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font-family:'EB Garamond',Georgia,serif;color:#111;line-height:1.55;}</style></head><body>${html}</body></html>`;
}
