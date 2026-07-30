"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Star,
  Sparkles,
  Info,
  MousePointerClick,
} from "lucide-react";
import { modalidadeLabel } from "@/lib/contracts/template-category";

interface CatalogEntry {
  token: string;
  label: string;
  description: string;
  required: boolean;
  kind: "simple" | "composed";
  present: boolean;
}
interface ValidateResult {
  found: string[];
  unknown: string[];
  missingRequired: string[];
  catalog: CatalogEntry[];
}
interface DraftReport {
  inserted?: { token: string; trecho: string }[];
  skippedAmbiguous?: { token: string; trecho: string; reason: string }[];
  notMapped?: string[];
  missingRequired?: string[];
  ranAt?: string;
}
interface TemplateInfo {
  id: string;
  name: string;
  modalidade: string;
  status: string;
  isDefault: boolean;
  docId: string;
  embedLink: string;
}

const SKIP_REASON: Record<string, string> = {
  ambiguous: "aparece em mais de um lugar",
  "not-found": "não encontrei no texto",
  "unknown-token": "chave fora do catálogo",
};

export function TemplateReviewClient({ template }: { template: TemplateInfo }) {
  const router = useRouter();
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [status, setStatus] = useState(template.status);
  const [isDefault, setIsDefault] = useState(template.isDefault);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Revisão por IA
  const [aiRunning, setAiRunning] = useState(false);
  const [report, setReport] = useState<DraftReport | null>(null);

  // Mapeamento manual
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [selText, setSelText] = useState("");
  const [mapping, setMapping] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const revalidate = useCallback(async () => {
    setValidating(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/validate-gdoc`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha na validação");
      setValidation(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na validação");
    } finally {
      setValidating(false);
    }
  }, [template.id]);

  const refreshDocText = useCallback(async () => {
    try {
      const res = await fetch(`/api/templates/${template.id}/doc-text`);
      const data = await res.json();
      if (res.ok) setParagraphs(data.paragraphs ?? []);
    } catch {
      /* ignore */
    }
  }, [template.id]);

  useEffect(() => {
    void revalidate();
    void refreshDocText();
  }, [revalidate, refreshDocText]);

  async function patchTemplate(body: Record<string, unknown>, okMsg: string) {
    setActivating(true);
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao atualizar template");
      toast.success(okMsg);
      if (typeof body.status === "string") setStatus(body.status);
      if (typeof body.isDefault === "boolean") setIsDefault(body.isDefault);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
    } finally {
      setActivating(false);
    }
  }

  async function activate() {
    if ((validation?.missingRequired ?? []).length > 0) {
      setConfirmOpen(true);
      return;
    }
    await patchTemplate({ status: "active" }, "Template ativado.");
  }

  async function runAI() {
    setAiRunning(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/rerun-ai`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha na revisão por IA");
      setReport(data.report as DraftReport);
      const n = (data.report?.inserted ?? []).length;
      toast.success(n > 0 ? `A IA preencheu ${n} campo(s).` : "A IA revisou o modelo.");
      await Promise.all([revalidate(), refreshDocText()]);
      setIframeKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na revisão por IA");
    } finally {
      setAiRunning(false);
    }
  }

  async function mapField(token: string, phrase: string) {
    const trecho = phrase.trim();
    if (trecho.length < 2) {
      toast.error("Selecione um trecho do texto primeiro.");
      return;
    }
    setMapping(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/map-field`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, phrase: trecho }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao mapear");
      toast.success(`Campo {{${token}}} inserido no modelo.`);
      setSelText("");
      window.getSelection?.()?.removeAllRanges();
      await Promise.all([revalidate(), refreshDocText()]);
      setIframeKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao mapear");
    } finally {
      setMapping(false);
    }
  }

  const catalog = validation?.catalog ?? [];
  const total = catalog.length;
  const done = catalog.filter((c) => c.present).length;
  const missing = catalog.filter((c) => !c.present);

  return (
    <div className="space-y-4">
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar com campos obrigatórios ausentes?</AlertDialogTitle>
            <AlertDialogDescription>
              Os campos{" "}
              <code className="rounded bg-muted px-1">
                {(validation?.missingRequired ?? []).map((t) => `{{${t}}}`).join(", ")}
              </code>{" "}
              não estão no modelo — não serão preenchidos nos contratos até você inseri-los.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e revisar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void patchTemplate({ status: "active" }, "Template ativado.");
              }}
            >
              Ativar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Como funciona */}
      <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
        <span>
          Este é o <b>seu modelo</b>. As <code className="rounded bg-muted px-1">{"{{chaves}}"}</code>{" "}
          são os campos que a IA preenche em cada contrato — <b className="text-success">verde</b> já
          está no modelo, <span className="text-muted-foreground">cinza</span> ainda falta. Peça a{" "}
          <b>revisão da IA</b> ou insira você mesmo: <b>selecione um trecho</b> abaixo e clique (ou
          arraste) a chave.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-h-[64vh] overflow-hidden rounded-lg border">
          <iframe
            key={iframeKey}
            src={template.embedLink}
            className="h-full min-h-[64vh] w-full"
            title="Modelo da imobiliária"
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>Status</span>
                <span className="flex items-center gap-1.5">
                  {/* A modalidade decide o catálogo de campos abaixo e qual
                      esteira acha este template — deixá-la visível evita
                      revisar um modelo de locação com campos de venda. */}
                  <Badge variant="outline" className="text-xs">
                    {modalidadeLabel(template.modalidade)}
                  </Badge>
                  <Badge variant={status === "active" ? "default" : "outline"}>
                    {status === "active" ? "Ativo" : status === "draft" ? "Rascunho" : status}
                  </Badge>
                  {isDefault && (
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      Padrão
                    </Badge>
                  )}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {total > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Campos preenchidos</span>
                    <span className="font-semibold tabular-nums">
                      {done}/{total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${Math.round((done / total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={runAI} disabled={aiRunning}>
                  {aiRunning ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Pedir revisão pela IA
                </Button>
                <Button size="sm" variant="outline" onClick={revalidate} disabled={validating}>
                  {validating ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Revalidar
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {status !== "active" && (
                  <Button size="sm" variant="outline" onClick={activate} disabled={activating || !validation}>
                    Ativar template
                  </Button>
                )}
                {status === "active" && !isDefault && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patchTemplate({ isDefault: true }, "Definido como padrão.")}
                    disabled={activating}
                  >
                    <Star className="mr-1.5 h-3.5 w-3.5" />
                    Definir como padrão
                  </Button>
                )}
              </div>
              {validation && validation.unknown.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Chaves desconhecidas (não serão preenchidas):{" "}
                    {validation.unknown.map((t) => `{{${t}}}`).join(", ")}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Relato da IA */}
          {report && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Sparkles className="h-4 w-4 text-primary" />O que a IA fez
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  Preencheu <b className="text-success">{(report.inserted ?? []).length}</b> campo(s).
                  {(report.skippedAmbiguous ?? []).length > 0 && (
                    <>
                      {" "}
                      Ficou em dúvida em{" "}
                      <b className="text-warning">{(report.skippedAmbiguous ?? []).length}</b>.
                    </>
                  )}
                </p>
                {(report.skippedAmbiguous ?? []).map((s, i) => (
                  <div key={i} className="rounded-md border bg-muted/30 p-2">
                    <code className="rounded bg-muted px-1">{`{{${s.token}}}`}</code>{" "}
                    <span className="text-muted-foreground">— {SKIP_REASON[s.reason] ?? s.reason}.</span>
                    {s.trecho && (
                      <p className="mt-1 line-clamp-2 italic text-muted-foreground">“{s.trecho}”</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Catálogo */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Campos do contrato</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="max-h-[40vh] space-y-1.5 overflow-y-auto pr-1 text-xs">
                {catalog.map((c) => (
                  <li key={c.token} className="flex items-start gap-2">
                    {c.present ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    )}
                    <div>
                      <code className="rounded bg-muted px-1 py-0.5">{`{{${c.token}}}`}</code>
                      {c.required && <span className="ml-1 text-warning">obrigatório</span>}
                      {c.kind === "composed" && (
                        <span className="ml-1 text-muted-foreground">(bloco)</span>
                      )}
                      <p className="text-muted-foreground">{c.label}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mapeamento manual */}
      {missing.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <MousePointerClick className="h-4 w-4 text-brand-accent" />
              Inserir campos que faltam
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              <b>Selecione</b> no texto abaixo o trecho que corresponde a um campo e{" "}
              <b>clique na chave</b> (ou arraste-a para o trecho selecionado). A chave substitui o
              trecho no modelo.
            </p>

            {/* Barra do trecho selecionado (drop target) */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const token = e.dataTransfer.getData("text/plain");
                if (token) void mapField(token, selText);
              }}
              className="flex min-h-9 items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs"
            >
              {mapping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : selText ? (
                <span className="line-clamp-1">
                  Trecho: <span className="italic">“{selText}”</span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Nenhum trecho selecionado — selecione um pedaço do texto abaixo.
                </span>
              )}
            </div>

            {/* Chips das chaves que faltam */}
            <div className="flex flex-wrap gap-1.5">
              {missing.map((c) => (
                <button
                  key={c.token}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", c.token)}
                  onClick={() => mapField(c.token, selText)}
                  disabled={mapping}
                  title={c.description || c.label}
                  className="inline-flex cursor-grab items-center gap-1 rounded-full border border-brand-accent/40 bg-brand-accent/5 px-2.5 py-1 text-[11px] font-medium text-brand-accent hover:bg-brand-accent/10 active:cursor-grabbing disabled:opacity-50"
                >
                  {`{{${c.token}}}`}
                  {c.required && <span className="text-warning">*</span>}
                </button>
              ))}
            </div>

            {/* Texto do doc (seleção) */}
            <div
              onMouseUp={() => setSelText(window.getSelection?.()?.toString().trim() ?? "")}
              className="max-h-[38vh] space-y-1.5 overflow-y-auto rounded-md border bg-card p-3 text-sm leading-relaxed"
            >
              {paragraphs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Carregando o texto do modelo…</p>
              ) : (
                paragraphs.map((p, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    {p}
                  </p>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
