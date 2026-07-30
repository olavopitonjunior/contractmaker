"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { previewFixturesForModalidade } from "@/lib/contracts/template-category";

interface TemplatePreviewProps {
  templateId: string;
  templateName: string;
  templateModalidade: string | null;
  templateEngine: "handlebars" | "google_docs" | string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PreviewResponse =
  | { mode: "google_docs"; docId: string; embedUrl: string; webViewLink: string }
  | { mode: "handlebars"; html: string; fixture: string };

/**
 * Diálogo de preview do template.
 *
 * Handlebars renderiza no servidor e chega como HTML — exibido em
 * `<iframe sandbox="" srcDoc>`, o mesmo padrão do documento da proposta
 * (`ProposalDocumentCard`). Sandbox vazio = sem scripts e sem acesso à origem;
 * o HTML já vem por `stripActiveContent` no servidor. Antes o HTML era subido
 * pro Google Docs só pra virar URL de iframe, e um OAuth expirado (semanal em
 * staging) matava o preview inteiro com `invalid_grant`.
 *
 * Engine `google_docs` continua embedando o Doc — ali ele é a FONTE do texto.
 */
export function TemplatePreview({
  templateId,
  templateName,
  templateModalidade,
  templateEngine,
  open,
  onOpenChange,
}: TemplatePreviewProps) {
  const isGdocs = templateEngine === "google_docs";

  // Amostras da família do template. Venda tem duas (à vista / financiamento);
  // locação, administração e proposta têm schema próprio, então uma só — e sem
  // escolha a fazer as abas não aparecem. Eram hardcode "À Vista |
  // Financiamento" pra qualquer engine handlebars, inclusive proposta.
  const fixtures = useMemo(
    () => previewFixturesForModalidade(templateModalidade),
    [templateModalidade]
  );
  const [fixture, setFixture] = useState<string>(fixtures[0].value);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A modalidade pode mudar no editor com o diálogo fechado.
  useEffect(() => {
    if (!fixtures.some((f) => f.value === fixture)) {
      setFixture(fixtures[0].value);
      setData(null);
    }
  }, [fixtures, fixture]);

  async function generate(target: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modalidade: target }),
      });
      const json = (await res.json()) as PreviewResponse | { error: string };
      if (!res.ok || "error" in json) {
        const msg = "error" in json ? json.error : "Falha ao gerar preview";
        setError(msg);
        toast.error(msg);
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro de conexão";
      setError(msg);
      toast.error(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && !data && !loading) {
      generate(fixture);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function selectFixture(v: string) {
    if (v === fixture) return;
    setFixture(v);
    setData(null);
    generate(v);
  }

  const html = data?.mode === "handlebars" ? data.html : null;
  const webViewLink = data?.mode === "google_docs" ? data.webViewLink : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[min(95vw,1200px)] flex flex-col gap-4"
      >
        <SheetHeader>
          <SheetTitle>Preview: {templateName}</SheetTitle>
          <SheetDescription>
            {isGdocs
              ? "Visualização do Google Doc original que serve como template."
              : "Renderização Handlebars com dados de exemplo. Cobre as condicionais do modelo (PF/PJ, cônjuge, procurador, múltiplas partes, parcelas)."}
          </SheetDescription>
        </SheetHeader>

        {!isGdocs && (
          <div className="flex items-center justify-between gap-2">
            {fixtures.length > 1 ? (
              <Tabs value={fixture} onValueChange={selectFixture}>
                <TabsList>
                  {fixtures.map((f) => (
                    <TabsTrigger key={f.value} value={f.value}>
                      {f.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : (
              <span className="text-xs text-muted-foreground">
                Dados de exemplo: {fixtures[0].label}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => generate(fixture)}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
              )}
              Atualizar preview
            </Button>
          </div>
        )}

        {isGdocs && webViewLink && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" asChild>
              <a href={webViewLink} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Abrir no Drive
              </a>
            </Button>
          </div>
        )}

        <div className="flex-1 min-h-0 rounded border bg-muted/30">
          {error ? (
            <div className="h-full flex items-center justify-center p-6 text-center text-sm text-destructive">
              {error}
            </div>
          ) : loading || !data ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Gerando preview...
            </div>
          ) : data.mode === "google_docs" ? (
            <iframe
              src={data.embedUrl}
              className="h-full w-full rounded"
              title={`Preview ${templateName}`}
            />
          ) : (
            <iframe
              // sandbox vazio = tudo bloqueado (scripts, formulários, mesma origem).
              sandbox=""
              srcDoc={wrapDocument(html ?? "")}
              className="h-full w-full rounded bg-white"
              title={`Preview ${templateName}`}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Envelope mínimo só quando o template não trouxe documento completo. */
function wrapDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font-family:'EB Garamond',Georgia,serif;color:#111;line-height:1.55;}</style></head><body>${html}</body></html>`;
}
