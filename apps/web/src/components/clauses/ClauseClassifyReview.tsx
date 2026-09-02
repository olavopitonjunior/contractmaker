"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Lock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  defaultDecisions,
  setField,
  setAllForClause,
  countApproved,
  buildReviewedItems,
  type ReviewDecisions,
  type ReviewableField,
} from "@/lib/clauses/proposal-review";
import { diffSummary, type ClauseClassificationProposal } from "@/lib/clauses/classify";
import { ESTEIRA_LABEL } from "@/lib/clauses/taxonomy";

const FIELD_LABEL: Record<ReviewableField, string> = {
  esteira: "Esteira",
  groupCode: "Grupo",
  subcategory: "Tema",
  tags: "Tags",
  agentNotes: "Orientação para o agente",
  content: "Texto da cláusula",
};

function renderValue(field: ReviewableField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "esteira" && typeof value === "string") {
    return ESTEIRA_LABEL[value as keyof typeof ESTEIRA_LABEL] ?? value;
  }
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

/**
 * Revisão das propostas do classificador, com diff campo a campo.
 *
 * Nada daqui vai pro banco sozinho: o rodapé monta o payload só com o que está
 * marcado, e o servidor revalida tudo de novo. O diff de TEXTO nasce
 * desmarcado — ver `defaultDecisions`.
 */
export function ClauseClassifyReview({
  open,
  onOpenChange,
  proposals,
  unchanged,
  undecided,
  failures,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposals: ClauseClassificationProposal[];
  unchanged: string[];
  /** Sem esteira E sem proposta: o modelo não decidiu. Não é "já classificada". */
  undecided: string[];
  failures: Array<{ clauseId: string; error: string }>;
  loading: boolean;
}) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<ReviewDecisions>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [seeded, setSeeded] = useState<string>("");

  // Semeia as decisões quando um lote NOVO chega (a chave é o conjunto de ids).
  const batchKey = proposals.map((p) => p.clauseId).join("|");
  if (batchKey !== seeded) {
    setSeeded(batchKey);
    setDecisions(defaultDecisions(proposals));
    setExpanded({});
  }

  const approvedCount = useMemo(() => countApproved(decisions), [decisions]);

  async function handleApply() {
    const items = buildReviewedItems(proposals, decisions);
    if (items.length === 0) {
      toast.info("Nada marcado para aplicar.");
      return;
    }
    setApplying(true);
    try {
      const res = await fetch("/api/clauses/classify/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Não foi possível aplicar.");
        return;
      }
      const applied = data.applied?.length ?? 0;
      const skipped = data.skipped?.length ?? 0;
      toast.success(
        `${applied} cláusula(s) atualizada(s)` +
          (data.reembedded ? `, ${data.reembedded} re-indexada(s)` : "") +
          (skipped ? ` · ${skipped} ignorada(s) na revalidação` : "")
      );
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Falha de rede ao aplicar.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Analisar e classificar</SheetTitle>
          <SheetDescription>
            Confira o que muda em cada cláusula. Só o que estiver marcado é aplicado.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analisando as cláusulas selecionadas...
            </div>
          )}

          {!loading && proposals.length === 0 && (
            <div
              className={`rounded-md border border-dashed py-12 text-center text-sm ${
                failures.length > 0 ? "border-destructive/40 text-destructive" : "text-muted-foreground"
              }`}
            >
              {/*
                As duas frases SOMAM em vez de competir. Em cascata, um lote com
                falhas E abstenções mostrava só a falha, e a informação de que N
                cláusulas continuam sem esteira sumia — perda silenciosa da
                mesma família que esta tela já teve duas vezes.
              */}
              {[
                // Sem isto a tela dizia "já estão classificadas" com as falhas
                // listadas logo abaixo — mentira que esconde o erro.
                failures.length > 0
                  ? `Não foi possível analisar ${failures.length} cláusula(s). Nada foi alterado.`
                  : null,
                // Cláusula do balde de triagem sobre a qual o modelo se absteve
                // NÃO está classificada, e dizer que está a prendia lá para
                // sempre.
                undecided.length > 0
                  ? `O modelo não conseguiu decidir a esteira de ${undecided.length} cláusula(s) pelo texto. Abra a cláusula e defina a esteira à mão — depois disso a análise consegue propor grupo, tema e chaves.`
                  : null,
              ]
                .filter(Boolean)
                .join(" ") ||
                "Nada a alterar — as cláusulas selecionadas já estão classificadas."}
            </div>
          )}

          {!loading &&
            proposals.map((p) => {
              const d = decisions[p.clauseId] ?? {};
              const isOpen = expanded[p.clauseId] ?? false;
              const fields = Object.keys(p.fields) as ReviewableField[];
              const allOn = fields.every((f) => d[f]);

              return (
                <div key={p.clauseId} className="mb-3 rounded-md border">
                  <div className="flex items-start gap-2 p-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((e) => ({ ...e, [p.clauseId]: !isOpen }))
                      }
                      className="mt-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={isOpen ? "Recolher" : "Expandir"}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{p.title}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 shrink-0 px-2 text-xs"
                          onClick={() =>
                            setDecisions((prev) => setAllForClause(prev, p, !allOn))
                          }
                        >
                          {allOn ? "Desmarcar tudo" : "Marcar tudo"}
                        </Button>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {diffSummary(p).map((s) => (
                          <Badge key={s} variant="secondary" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{p.reason}</p>

                      {p.warnings.map((w, i) => (
                        <div
                          key={i}
                          className={`mt-2 flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs ${
                            w.kind === "pii_detectada" || w.kind === "contratos_vinculados"
                              ? "border-destructive/40 text-destructive"
                              : "border-amber-500/40 text-amber-700 dark:text-amber-500"
                          }`}
                        >
                          {w.kind === "tags_congeladas" ? (
                            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          )}
                          <span>{w.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {isOpen && (
                    <>
                      <Separator />
                      <div className="space-y-3 p-3">
                        {fields.map((f) => {
                          const field = p.fields[f];
                          if (!field) return null;
                          const isContent = f === "content";
                          return (
                            <div key={f} className="space-y-1">
                              <label className="flex items-center gap-2 text-xs font-medium">
                                <Checkbox
                                  checked={!!d[f]}
                                  onCheckedChange={(v) =>
                                    setDecisions((prev) =>
                                      setField(prev, p.clauseId, f, v === true)
                                    )
                                  }
                                />
                                {FIELD_LABEL[f]}
                                {isContent && (
                                  <Badge variant="outline" className="text-[10px]">
                                    reescreve o texto
                                  </Badge>
                                )}
                              </label>
                              {isContent ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <pre className="max-h-48 overflow-auto rounded bg-destructive/5 p-2 text-[11px] whitespace-pre-wrap">
                                    {field.current as string}
                                  </pre>
                                  <pre className="max-h-48 overflow-auto rounded bg-emerald-500/5 p-2 text-[11px] whitespace-pre-wrap">
                                    {field.proposed as string}
                                  </pre>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="text-muted-foreground line-through">
                                    {renderValue(f, field.current)}
                                  </span>
                                  <span aria-hidden>→</span>
                                  <span className="font-medium">
                                    {renderValue(f, field.proposed)}
                                  </span>
                                </div>
                              )}
                              {isContent &&
                                "mappings" in field &&
                                field.mappings.length > 0 && (
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    {field.mappings.map((m) => (
                                      <Badge
                                        key={m.chave}
                                        variant={
                                          m.tier === "condicional" ? "outline" : "secondary"
                                        }
                                        className="text-[10px]"
                                        title={
                                          m.tier === "condicional"
                                            ? "Esta chave só resolve em parte das modalidades desta esteira."
                                            : undefined
                                        }
                                      >
                                        {m.trecho} → {`{{${m.chave}}}`}
                                        {m.tier === "condicional" ? " ⚠" : ""}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}

          {!loading && unchanged.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {unchanged.length} cláusula(s) já estavam no padrão e não precisam de mudança.
            </p>
          )}
          {!loading && undecided.length > 0 && proposals.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {undecided.length} cláusula(s) continuam sem esteira: o modelo não
              conseguiu decidir pelo texto. Defina a esteira à mão na própria
              cláusula.
            </p>
          )}
          {!loading &&
            failures.map((f) => (
              <p key={f.clauseId} className="mt-1 text-xs text-destructive">
                Falha ao analisar uma cláusula: {f.error}
              </p>
            ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t p-4">
          <span className="text-xs text-muted-foreground">
            {approvedCount} alteração(ões) marcada(s)
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={applying || loading || approvedCount === 0}
            >
              {applying ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Aplicar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
