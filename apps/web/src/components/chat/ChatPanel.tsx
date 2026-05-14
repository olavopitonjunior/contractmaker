"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Send,
  RotateCw,
  Zap,
  Brain,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentEvent, AgentMode } from "@/lib/ai/types";
import { describeTool, KIND_CLASSES } from "@/lib/ai/event-icons";

interface Message {
  id: string;
  role: string;
  content: string;
  isError?: boolean;
  retryPayload?: string;
  events?: AgentEvent[];
  mode?: AgentMode;
  streaming?: boolean;
}

interface ChatPanelProps {
  contractId: string;
  messages: Message[];
  onContentUpdate?: (html: string) => void;
  /** Disparado a cada turn que termina com sucesso (evento `done`). */
  onChatTurnComplete?: () => void;
  initialInput?: string;
}

export function ChatPanel({
  contractId,
  messages: initialMessages,
  onContentUpdate,
  onChatTurnComplete,
  initialInput,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState(initialInput ?? "");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<AgentMode>("plan");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function sendMessage(userMessage: string) {
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 280_000);

    // Mensagem do assistente em streaming — começa vazia e vai ganhando
    // events + content delta. Após `done`, vira mensagem final.
    const aiId = `ai-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: aiId,
        role: "assistant",
        content: "",
        events: [],
        mode,
        streaming: true,
      },
    ]);

    try {
      const res = await fetch(`/api/contracts/${contractId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, mode }),
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        let errorMsg = `Erro ${res.status}: `;
        if (res.status === 504 || res.status === 408) {
          errorMsg += "o assistente demorou demais para responder.";
        } else if (contentType.includes("application/json")) {
          try {
            const data = await res.json();
            errorMsg += data.error || "falha ao processar mensagem.";
          } catch {
            errorMsg += "resposta inválida do servidor.";
          }
        } else {
          errorMsg += "falha no servidor.";
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? { ...m, content: errorMsg, isError: true, retryPayload: userMessage, streaming: false }
              : m
          )
        );
        return;
      }

      if (!contentType.includes("text/event-stream")) {
        // Fallback: server retornou JSON (caminho de erro 403/etc)
        const data = await res.json();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? {
                  ...m,
                  content: data.message || "Sem resposta",
                  streaming: false,
                }
              : m
          )
        );
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let textBuf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames separados por \n\n; cada frame começa com `data: `.
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
            setMessages((prev) =>
              prev.map((m) => (m.id === aiId ? { ...m, content: textBuf } : m))
            );
          } else if (event.type === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiId
                  ? {
                      ...m,
                      content: event.result.message || textBuf || "Operação concluída.",
                      events: event.result.events || m.events,
                      streaming: false,
                    }
                  : m
              )
            );
            if (event.result.htmlContent && onContentUpdate) {
              onContentUpdate(event.result.htmlContent);
            }
            onChatTurnComplete?.();
          } else if (event.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiId
                  ? {
                      ...m,
                      content: `Erro: ${event.message}`,
                      isError: true,
                      retryPayload: userMessage,
                      streaming: false,
                    }
                  : m
              )
            );
          } else {
            // started / tool_use / tool_result / verification — anexa à timeline
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiId ? { ...m, events: [...(m.events || []), event] } : m
              )
            );
          }
        }
      }
    } catch (err: unknown) {
      const isAbort = (err as { name?: string })?.name === "AbortError";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId
            ? {
                ...m,
                content: isAbort
                  ? "O assistente demorou demais para responder e a requisição foi cancelada."
                  : `Erro de conexão: ${(err as Error).message || "não foi possível completar a requisição"}`,
                isError: true,
                retryPayload: userMessage,
                streaming: false,
              }
            : m
        )
      );
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: userMessage },
    ]);
    await sendMessage(userMessage);
  }

  async function handleRetry(payload: string) {
    if (loading) return;
    await sendMessage(payload);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full max-h-[calc(100dvh-80px)]">
        <ModeHeader mode={mode} onChange={setMode} disabled={loading} />

        <ScrollArea className="flex-1 min-h-0 pr-4" ref={scrollRef}>
          <div className="space-y-4 py-4">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Envie uma mensagem para editar o contrato com IA.
                <br />
                Ex: &quot;Altere o valor do sinal para R$ 80.000&quot;
              </p>
            )}
            {messages.map((msg) => (
              <MessageRow
                key={msg.id}
                msg={msg}
                loading={loading}
                onRetry={handleRetry}
              />
            ))}
          </div>
        </ScrollArea>

        <div className="border-t pt-4 flex gap-2">
          <Input
            placeholder={
              mode === "fast"
                ? "Edição rápida — Haiku · ~3s"
                : "Pergunte ou planeje uma alteração — Sonnet · ~20s"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <Button size="icon" onClick={handleSend} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ============================================
// SUB-COMPONENTES
// ============================================

function ModeHeader({
  mode,
  onChange,
  disabled,
}: {
  mode: AgentMode;
  onChange: (m: AgentMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 pb-2 border-b">
      <span className="text-xs text-muted-foreground mr-2">Modo</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={mode === "fast" ? "default" : "outline"}
            size="sm"
            className="h-7"
            onClick={() => onChange("fast")}
            disabled={disabled}
          >
            <Zap className="h-3 w-3 mr-1" />
            Rápido
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs max-w-[220px]">
            <p className="font-semibold">Edição rápida (Haiku)</p>
            <p className="text-muted-foreground">
              1 iteração, sem expert context, edita direto no Google Doc. Ideal pra correções pontuais.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={mode === "plan" ? "default" : "outline"}
            size="sm"
            className="h-7"
            onClick={() => onChange("plan")}
            disabled={disabled}
          >
            <Brain className="h-3 w-3 mr-1" />
            Planejar
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs max-w-[220px]">
            <p className="font-semibold">Planejamento (Sonnet)</p>
            <p className="text-muted-foreground">
              Até 5 iterações, consulta base de conhecimento, sugestões em vez de edição direta no Google Doc.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function MessageRow({
  msg,
  loading,
  onRetry,
}: {
  msg: Message;
  loading: boolean;
  onRetry: (payload: string) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="rounded-lg p-3 text-sm bg-primary text-primary-foreground ml-8">
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg p-3 text-sm mr-8",
        msg.isError
          ? "bg-destructive/10 border border-destructive/30 text-destructive-foreground"
          : "bg-muted"
      )}
    >
      <EventTimeline events={msg.events} streaming={!!msg.streaming} />
      {msg.content && <p className="whitespace-pre-wrap mt-2">{msg.content}</p>}
      {!msg.content && msg.streaming && (
        <p className="text-xs text-muted-foreground italic mt-1">Pensando…</p>
      )}
      {msg.isError && msg.retryPayload && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={loading}
          onClick={() => onRetry(msg.retryPayload!)}
        >
          <RotateCw className="h-3 w-3 mr-1" />
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

function EventTimeline({
  events,
  streaming,
}: {
  events?: AgentEvent[];
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!events || events.length === 0) {
    return null;
  }

  // Filtra eventos visíveis: started, tool_use, tool_result, verification.
  // text_delta não vai aqui (vira o content principal).
  const visible = events.filter((e) =>
    ["started", "tool_use", "tool_result", "verification"].includes(e.type)
  );

  if (visible.length === 0) return null;

  // Agrupa tool_use + tool_result + verification por (name + iteration)
  type ToolStep = {
    key: string;
    name: string;
    iteration: number;
    status: "running" | "success" | "failure";
    summary?: string;
    verified?: boolean;
  };
  const steps: ToolStep[] = [];
  const started = visible.find((e) => e.type === "started");

  for (const e of visible) {
    if (e.type === "tool_use") {
      steps.push({
        key: `${e.name}-${e.iteration}-${steps.length}`,
        name: e.name,
        iteration: e.iteration,
        status: "running",
      });
    } else if (e.type === "tool_result") {
      // Match com o último tool_use do mesmo name+iteration ainda em "running"
      for (let i = steps.length - 1; i >= 0; i--) {
        const s = steps[i];
        if (s.name === e.name && s.iteration === e.iteration && s.status === "running") {
          s.status = e.success ? "success" : "failure";
          s.summary = e.summary;
          break;
        }
      }
    } else if (e.type === "verification") {
      for (let i = steps.length - 1; i >= 0; i--) {
        const s = steps[i];
        if (s.name === e.tool) {
          s.verified = e.verified;
          if (!e.verified) s.status = "failure";
          break;
        }
      }
    }
  }

  const compact = !expanded && steps.length > 4;
  const visibleSteps = compact ? steps.slice(-3) : steps;
  const hiddenCount = steps.length - visibleSteps.length;

  return (
    <div className="space-y-1.5">
      {started && started.type === "started" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {started.mode === "fast" ? <Zap className="h-3 w-3" /> : <Brain className="h-3 w-3" />}
          <span>
            {started.mode === "fast" ? "Edição rápida" : "Planejamento"} · {started.model.replace("claude-", "")}
            {started.hasExpertContext && " · expert context"}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 self-start"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded ? "Mostrar menos" : `+${hiddenCount} ferramenta(s) anterior(es)`}
          </button>
        )}

        {visibleSteps.map((step) => (
          <ToolChip key={step.key} step={step} streaming={streaming} />
        ))}
      </div>
    </div>
  );
}

function ToolChip({
  step,
  streaming,
}: {
  step: {
    name: string;
    status: "running" | "success" | "failure";
    summary?: string;
    verified?: boolean;
  };
  streaming: boolean;
}) {
  const descriptor = describeTool(step.name);
  const Icon = descriptor.icon;
  const kindClass = KIND_CLASSES[descriptor.kind];

  let statusIcon: React.ReactNode = null;
  if (step.status === "running" && streaming) {
    statusIcon = <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
  } else if (step.status === "success") {
    statusIcon = <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
  } else if (step.status === "failure") {
    statusIcon = <XCircle className="h-3 w-3 text-red-600" />;
  }

  return (
    <div
      className={cn(
        "inline-flex items-start gap-2 rounded-md border px-2 py-1 text-[11px]",
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
