"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Circle,
  ChevronDown,
  ChevronRight,
  Loader2,
  ListChecks,
  Eye,
  Pencil,
  Edit3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PlanStep, AgentEvent } from "@/lib/ai/types";

interface PlanCardProps {
  contractId: string;
  planId: string;
  steps: PlanStep[];
  /** Callback acionado ao terminar execucao (UI parent refresh htmlContent). */
  onExecuted?: () => void;
}

/**
 * PlanCard renderiza o output de um propose_plan turn — lista de reads
 * (auto-executados, ✓ verde) + writes pendentes (checkbox + descricao).
 * Botao "Aprovar selecionados" dispara POST /execute-plan e stream SSE
 * atualiza cada step inline.
 */
export function PlanCard({ contractId, planId, steps, onExecuted }: PlanCardProps) {
  const writeSteps = steps.filter((s) => s.type === "write");
  const readSteps = steps.filter((s) => s.type === "read");

  // Aprovados por default — usuario desmarca os que nao quer
  const [approved, setApproved] = useState<Set<string>>(
    new Set(writeSteps.filter((s) => s.status === "pending").map((s) => s.id))
  );
  const [executing, setExecuting] = useState(false);
  const [completed, setCompleted] = useState(
    !writeSteps.some((s) => s.status === "pending")
  );
  // Overrides do input editados pelo usuario via dialog. Sao mesclados no
  // POST /execute-plan via stepInputOverrides. Persistem ate o turn ser
  // executado (recarrega do server depois).
  const [overrides, setOverrides] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepStates, setStepStates] = useState<
    Record<string, { status: PlanStep["status"]; summary?: string }>
  >(
    Object.fromEntries(
      steps.map((s) => [s.id, { status: s.status, summary: s.result?.summary }])
    )
  );
  const [readsExpanded, setReadsExpanded] = useState(false);

  function toggleApproval(id: string) {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApprove() {
    if (executing || completed) return;
    setExecuting(true);

    try {
      const res = await fetch(`/api/contracts/${contractId}/chat/execute-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          approvedStepIds: Array.from(approved),
          ...(Object.keys(overrides).length > 0 ? { stepInputOverrides: overrides } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as AgentEvent;
            if (event.type === "plan_step_result") {
              setStepStates((prev) => ({
                ...prev,
                [event.stepId]: { status: event.status, summary: event.summary },
              }));
            }
            if (event.type === "done") {
              setCompleted(true);
              onExecuted?.();
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      // marca tudo como falha
      setStepStates((prev) => {
        const next = { ...prev };
        for (const id of approved) {
          if (next[id]?.status === "pending") {
            next[id] = {
              status: "failed",
              summary: err instanceof Error ? err.message : "Falha",
            };
          }
        }
        return next;
      });
    } finally {
      setExecuting(false);
    }
  }

  // Progress dots: 1 dot per step (read+write). Verde se executed, vermelho
  // se failed, vazio se pending/rejected.
  const allStepStatuses = steps.map((s) => stepStates[s.id]?.status || s.status);

  return (
    <div className="rounded-md border bg-card mt-2">
      <div className="flex items-start gap-3 px-3 py-2.5 border-b">
        <ListChecks className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold leading-tight">Plano de execução</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {readSteps.filter((s) => (stepStates[s.id]?.status || s.status) === "executed").length}{" "}
            análise{readSteps.length !== 1 ? "s" : ""} concluída{readSteps.length !== 1 ? "s" : ""}
            {writeSteps.length > 0 && (
              <>
                ,{" "}
                {writeSteps.filter((s) => (stepStates[s.id]?.status || s.status) === "pending").length}{" "}
                ação{writeSteps.filter((s) => (stepStates[s.id]?.status || s.status) === "pending").length !== 1 ? "ões" : ""} pendente{writeSteps.filter((s) => (stepStates[s.id]?.status || s.status) === "pending").length !== 1 ? "s" : ""}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5" aria-hidden="true">
          {allStepStatuses.map((status, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                status === "executed" && "bg-emerald-500",
                status === "failed" && "bg-destructive",
                status === "skipped" && "bg-amber-400/70",
                status === "rejected" && "bg-muted-foreground/30",
                (status === "pending" || status === "approved") &&
                  "bg-muted-foreground/40 ring-1 ring-muted-foreground/40 ring-offset-0"
              )}
            />
          ))}
        </div>
      </div>

      {/* Reads — collapsible (auto-executados) */}
      {readSteps.length > 0 && (
        <div className="border-b">
          <button
            type="button"
            onClick={() => setReadsExpanded((v) => !v)}
            className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted/40 transition-colors text-left"
          >
            {readsExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
            <Eye className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              Análises feitas ({readSteps.length})
            </span>
          </button>
          {readsExpanded && (
            <ul className="px-3 pb-2 space-y-0.5">
              {readSteps.map((step) => {
                const state = stepStates[step.id] || { status: step.status };
                return (
                  <li
                    key={step.id}
                    className="flex items-start gap-2 text-[11px] text-muted-foreground"
                  >
                    {state.status === "executed" ? (
                      <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-emerald-600" />
                    ) : state.status === "failed" ? (
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0 text-destructive" />
                    ) : (
                      <Circle className="h-3 w-3 mt-0.5 shrink-0" />
                    )}
                    <span className="flex-1">
                      {step.description}
                      {step.result?.summary && (
                        <span className="text-muted-foreground/70">
                          {" "}— {step.result.summary}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Writes — checkboxes + Edit como hover + footer 3-zonas */}
      <div className="p-3">
        {writeSteps.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma edição proposta. Plano só de análise.
          </p>
        ) : (
          <>
            <p className="text-[11px] font-medium mb-2 text-muted-foreground">
              Próximas alterações
            </p>
            <ul className="space-y-1 mb-3">
              {writeSteps.map((step) => {
                const state = stepStates[step.id] || { status: step.status };
                const isPending = state.status === "pending";
                return (
                  <li
                    key={step.id}
                    className="group flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors"
                  >
                    {isPending && !completed ? (
                      <input
                        type="checkbox"
                        id={`step-${step.id}`}
                        checked={approved.has(step.id)}
                        onChange={() => toggleApproval(step.id)}
                        disabled={executing}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
                      />
                    ) : state.status === "executed" ? (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                    ) : state.status === "failed" ? (
                      <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                    ) : state.status === "rejected" ? (
                      <Circle className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground/50" />
                    ) : state.status === "skipped" ? (
                      <Circle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                    ) : (
                      <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-muted-foreground" />
                    )}
                    <label
                      htmlFor={`step-${step.id}`}
                      className={cn(
                        "flex-1 text-xs leading-snug cursor-pointer min-w-0",
                        state.status === "rejected" && "line-through text-muted-foreground/60",
                        state.status === "skipped" && "line-through text-amber-700/70 dark:text-amber-400/70",
                        !isPending && "cursor-default"
                      )}
                    >
                      <div className="font-medium">{step.description}</div>
                      <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                        <code className="bg-muted/80 text-foreground/70 rounded px-1.5 py-0.5 font-mono">
                          {step.tool}
                        </code>
                        {overrides[step.id] && (
                          <span className="rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 font-medium">
                            editado
                          </span>
                        )}
                        {state.summary && (
                          <span className="truncate">— {state.summary}</span>
                        )}
                      </div>
                    </label>
                    {isPending && !completed && (
                      <button
                        type="button"
                        onClick={() => setEditingStepId(step.id)}
                        disabled={executing}
                        className={cn(
                          "rounded-sm p-1 hover:bg-muted-foreground/20 text-muted-foreground disabled:opacity-40",
                          "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        )}
                        aria-label="Editar input do step"
                        title="Editar"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            {!completed && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setApproved(new Set())}
                  disabled={executing || approved.size === 0}
                >
                  Recusar tudo
                </Button>
                <span className="flex-1 text-center text-[11px] text-muted-foreground">
                  {approved.size} de {writeSteps.length} selecionada{writeSteps.length === 1 ? "" : "s"}
                </span>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleApprove}
                  disabled={executing || approved.size === 0}
                >
                  {executing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      Executando…
                    </>
                  ) : (
                    <>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Aprovar ({approved.size})
                    </>
                  )}
                </Button>
              </div>
            )}
            {completed && (
              <p className="text-[11px] text-muted-foreground text-center mt-2 pt-2 border-t">
                Plano concluído.
              </p>
            )}
          </>
        )}
      </div>

      {/* Dialog de edição do input do step. Renderiza quando editingStepId
          aponta pra um step pendente. Salvar valida JSON, atualiza overrides
          state e fecha — só vai pro server no proximo /execute-plan. */}
      <EditStepDialog
        step={
          editingStepId
            ? writeSteps.find((s) => s.id === editingStepId) ?? null
            : null
        }
        currentInput={
          editingStepId
            ? overrides[editingStepId] ??
              writeSteps.find((s) => s.id === editingStepId)?.input ??
              {}
            : {}
        }
        onClose={() => setEditingStepId(null)}
        onSave={(stepId, newInput) => {
          setOverrides((prev) => ({ ...prev, [stepId]: newInput }));
          setEditingStepId(null);
        }}
        onReset={(stepId) => {
          setOverrides((prev) => {
            const next = { ...prev };
            delete next[stepId];
            return next;
          });
          setEditingStepId(null);
        }}
      />
    </div>
  );
}

/**
 * Dialog pra editar o `input` de um step antes de aprovar. Aceita JSON
 * livre (textarea), valida no submit. Em caso de input invalido mostra
 * erro inline. "Restaurar original" remove o override e usa o input
 * proposto pelo agente.
 */
function EditStepDialog({
  step,
  currentInput,
  onClose,
  onSave,
  onReset,
}: {
  step: PlanStep | null;
  currentInput: Record<string, unknown>;
  onClose: () => void;
  onSave: (stepId: string, newInput: Record<string, unknown>) => void;
  onReset: (stepId: string) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = step !== null;

  // Atualiza textarea quando abre o dialog (step muda).
  React.useEffect(() => {
    if (step) {
      setText(JSON.stringify(currentInput, null, 2));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  if (!step) return null;

  function handleSave() {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Input precisa ser um objeto JSON ({...}).");
        return;
      }
      onSave(step!.id, parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "JSON inválido");
    }
  }

  const isModified =
    JSON.stringify(currentInput) !== JSON.stringify(step.input);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Ajustar parâmetros do step</DialogTitle>
          <DialogDescription className="text-xs">
            <code className="bg-muted/60 rounded px-1 py-0.5">{step.tool}</code>
            {" — "}
            {step.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium">Parâmetros (JSON)</label>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={12}
            className="font-mono text-xs"
            spellCheck={false}
          />
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Ajuste só se a IA inferiu errado (ex: trecho com aspas diferentes do
            doc). Campos comuns em <code className="font-mono">edit_contract_section</code>:{" "}
            <code className="font-mono bg-muted/60 px-1 py-0.5 rounded">target</code> e{" "}
            <code className="font-mono bg-muted/60 px-1 py-0.5 rounded">replacement</code>.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {isModified && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onReset(step.id)}
            >
              Restaurar original
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave}>
            Salvar edição
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
