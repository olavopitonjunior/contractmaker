"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, ShieldAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentEvent } from "@/lib/ai/types";
import { describeTool, KIND_CLASSES } from "@/lib/ai/event-icons";

interface AiResolveDialogProps {
  open: boolean;
  contractId: string;
  comment: {
    id: string;
    text: string;
    selectedText: string;
    severity: string;
  } | null;
  onClose: () => void;
  onSuccess?: () => void;
  onContentUpdate?: (html: string) => void;
}

type Step = {
  key: string;
  name: string;
  iteration: number;
  status: "running" | "success" | "failure";
  summary?: string;
  verified?: boolean;
};

export function AiResolveDialog({
  open,
  contractId,
  comment,
  onClose,
  onSuccess,
  onContentUpdate,
}: AiResolveDialogProps) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "streaming" | "success" | "failure">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Inicia o stream ao abrir o dialog (uma vez por comment).
  useEffect(() => {
    if (!open || !comment || startedRef.current) return;
    startedRef.current = true;
    setSteps([]);
    setText("");
    setErrorMsg(null);
    setPhase("streaming");

    let cancelled = false;
    let resolvedSucceeded = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/contracts/${contractId}/comments/${comment.id}/ai-resolve`,
          { method: "POST" }
        );
        if (!res.ok) {
          if (cancelled) return;
          const errBody = await res
            .json()
            .catch(() => ({ error: `HTTP ${res.status}` }));
          setPhase("failure");
          setErrorMsg(errBody.error || "Falha ao iniciar agente");
          return;
        }
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("text/event-stream")) {
          setPhase("failure");
          setErrorMsg("Servidor retornou formato inesperado");
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let textBuf = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
            if (!line) continue;
            let event: AgentEvent;
            try {
              event = JSON.parse(line) as AgentEvent;
            } catch {
              continue;
            }

            if (event.type === "text_delta") {
              textBuf += event.text;
              setText(textBuf);
            } else if (event.type === "tool_use") {
              setSteps((prev) => [
                ...prev,
                {
                  key: `${event.name}-${event.iteration}-${prev.length}`,
                  name: event.name,
                  iteration: event.iteration,
                  status: "running",
                },
              ]);
            } else if (event.type === "tool_result") {
              setSteps((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                  if (
                    next[i].name === event.name &&
                    next[i].iteration === event.iteration &&
                    next[i].status === "running"
                  ) {
                    next[i] = {
                      ...next[i],
                      status: event.success ? "success" : "failure",
                      summary: event.summary,
                    };
                    break;
                  }
                }
                return next;
              });
              if (event.name === "_resolve_comment" && event.success) {
                resolvedSucceeded = true;
              }
            } else if (event.type === "verification") {
              setSteps((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].name === event.tool) {
                    next[i] = {
                      ...next[i],
                      verified: event.verified,
                      status: event.verified ? next[i].status : "failure",
                    };
                    break;
                  }
                }
                return next;
              });
            } else if (event.type === "done") {
              if (event.result.htmlContent && onContentUpdate) {
                onContentUpdate(event.result.htmlContent);
              }
            } else if (event.type === "error") {
              if (!cancelled) {
                setPhase("failure");
                setErrorMsg(event.message);
              }
              return;
            }
          }
        }

        if (cancelled) return;
        if (resolvedSucceeded) {
          setPhase("success");
          onSuccess?.();
        } else {
          setPhase("failure");
          setErrorMsg(
            "IA não conseguiu aplicar a correção automaticamente — precisa ser resolvido manualmente."
          );
        }
      } catch (err) {
        if (cancelled) return;
        setPhase("failure");
        setErrorMsg(err instanceof Error ? err.message : "Erro desconhecido");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, comment, contractId, onContentUpdate, onSuccess]);

  // Reset flag ao fechar pra permitir abrir de novo num outro comment.
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Resolver com IA
          </DialogTitle>
          <DialogDescription>
            {comment ? (
              <span className="text-xs">
                Trecho:{" "}
                <em className="italic">
                  &quot;{comment.selectedText.slice(0, 80)}
                  {comment.selectedText.length > 80 ? "…" : ""}&quot;
                </em>
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {steps.length === 0 && phase === "streaming" && (
            <p className="text-xs text-muted-foreground italic">
              <Loader2 className="inline h-3 w-3 mr-1 animate-spin" />
              Iniciando agente em modo rápido…
            </p>
          )}
          {steps.map((step) => (
            <StepChip key={step.key} step={step} streaming={phase === "streaming"} />
          ))}
          {text && (
            <div className="rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap mt-2">
              {text}
            </div>
          )}
          {phase === "success" && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 p-2 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Correção aplicada — comentário marcado como resolvido.
            </div>
          )}
          {phase === "failure" && errorMsg && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-2 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {phase === "streaming" ? "Fechar (continua em background)" : "Fechar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepChip({ step, streaming }: { step: Step; streaming: boolean }) {
  const descriptor = describeTool(step.name);
  const Icon = descriptor.icon;
  const kindClass = KIND_CLASSES[descriptor.kind];

  let statusIcon: React.ReactNode = null;
  if (step.status === "running" && streaming) {
    statusIcon = <Loader2 className="h-3 w-3 animate-spin" />;
  } else if (step.status === "success") {
    statusIcon = <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
  } else if (step.status === "failure") {
    statusIcon = <XCircle className="h-3 w-3 text-red-600" />;
  }

  return (
    <div
      className={cn(
        "inline-flex items-start gap-2 rounded-md border px-2 py-1 text-[11px] w-full",
        kindClass
      )}
    >
      <Icon className="h-3 w-3 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{descriptor.label}</span>
          {statusIcon}
          {step.verified === false && (
            <span className="inline-flex items-center gap-0.5 text-red-700 dark:text-red-300">
              <ShieldAlert className="h-3 w-3" /> não verificado
            </span>
          )}
        </div>
        {step.summary && (
          <p className="text-[10px] text-muted-foreground truncate">{step.summary}</p>
        )}
      </div>
    </div>
  );
}
