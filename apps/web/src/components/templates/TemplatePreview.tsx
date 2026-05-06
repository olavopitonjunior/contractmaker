"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Loader2, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";

interface TemplatePreviewProps {
  templateId: string;
  templateName: string;
  templateModalidade: "a_vista" | "financiamento" | string | null;
  templateEngine: "handlebars" | "google_docs" | string;
  /** Indica se o preview salvo está stale (source mudou desde o último upload). */
  previewStale: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PreviewResponse {
  docId: string;
  embedUrl: string;
  webViewLink: string;
  cached: boolean;
  mode: "handlebars" | "google_docs";
}

export function TemplatePreview({
  templateId,
  templateName,
  templateModalidade,
  templateEngine,
  previewStale,
  open,
  onOpenChange,
}: TemplatePreviewProps) {
  const isGdocs = templateEngine === "google_docs";
  const [fixture, setFixture] = useState<"a_vista" | "financiamento">(
    templateModalidade === "financiamento" ? "financiamento" : "a_vista"
  );
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modalidade: fixture, force }),
      });
      const json = (await res.json()) as PreviewResponse | { error: string };
      if (!res.ok || "error" in json) {
        const msg = "error" in json ? json.error : "Falha ao gerar preview";
        setError(msg);
        toast.error(msg);
        return;
      }
      setData(json);
      if (force) toast.success("Preview atualizado.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro de conexão";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && !data && !loading) {
      generate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset state when fixture changes (handlebars mode only)
  useEffect(() => {
    if (open && !isGdocs && data && data.mode === "handlebars") {
      setData(null);
      // Re-fetch with the new fixture
      generate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture]);

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
              : "Renderização Handlebars com dados de exemplo. Cobre todas as condicionais (PF/PJ, cônjuge, procurador, múltiplas partes, parcelas)."}
          </SheetDescription>
        </SheetHeader>

        {!isGdocs && (
          <div className="flex items-center justify-between gap-2">
            <Tabs
              value={fixture}
              onValueChange={(v) =>
                setFixture(v as "a_vista" | "financiamento")
              }
            >
              <TabsList>
                <TabsTrigger value="a_vista">À Vista</TabsTrigger>
                <TabsTrigger value="financiamento">Financiamento</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              {data && (
                <Button size="sm" variant="ghost" asChild>
                  <a
                    href={data.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Abrir no Drive
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => generate(true)}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                Atualizar preview
              </Button>
            </div>
          </div>
        )}

        {previewStale && !isGdocs && data?.cached && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            Preview desatualizado — o template foi editado. Clique em
            "Atualizar preview" para regerar.
          </div>
        )}

        <div className="flex-1 min-h-0 rounded border bg-muted/30">
          {error ? (
            <div className="h-full flex items-center justify-center p-6 text-sm text-destructive">
              {error}
            </div>
          ) : !data ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Gerando preview...
            </div>
          ) : (
            <iframe
              src={data.embedUrl}
              className="h-full w-full rounded"
              title={`Preview ${templateName}`}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
