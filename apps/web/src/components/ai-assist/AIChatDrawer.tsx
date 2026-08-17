"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  Send,
  RotateCcw,
  LifeBuoy,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { describeTool, KIND_CLASSES } from "@/lib/ai/event-icons";
import { describeScreen } from "@/lib/support/route-map";

interface ToolStep {
  name: string;
  status: "running" | "success";
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  steps?: ToolStep[];
  interactionId?: string | null;
  handoff?: boolean;
  rating?: 1 | -1;
  streaming?: boolean;
  isError?: boolean;
}

// Sugestões: as de /locacao só aparecem em telas de locação; as de ajuda genérica
// aparecem em qualquer tela.
const SUGGESTIONS: Array<{ context: string[]; label: string }> = [
  { context: ["*"], label: "O que eu faço nesta tela?" },
  { context: ["*"], label: "Como gero um contrato?" },
  { context: ["*"], label: "Como envio um contrato para assinatura?" },
  { context: ["/pipeline"], label: "Como crio um novo negócio?" },
  { context: ["/templates"], label: "Como defino o modelo padrão?" },
  { context: ["/financeiro"], label: "Como emito uma cobrança de comissão?" },
  { context: ["/locacao"], label: "Como está minha inadimplência este mês?" },
  { context: ["/locacao/contratos/"], label: "Resumo deste contrato" },
];

interface SseEvent {
  type: "text_delta" | "tool_use" | "tool_result" | "handoff" | "done" | "error";
  text?: string;
  name?: string;
  handoffId?: string;
  interactionId?: string | null;
  handoff?: boolean;
  message?: string;
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

function ToolChip({ step }: { step: ToolStep }) {
  const d = describeTool(step.name);
  const Icon = d.icon;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
        KIND_CLASSES[d.kind]
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="font-medium">{d.label}</span>
      {step.status === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : (
        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
      )}
    </div>
  );
}

export function AIChatDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const screen = describeScreen(pathname);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, sending]);

  const suggestions = SUGGESTIONS.filter(
    (s) => s.context.includes("*") || s.context.some((c) => pathname.includes(c))
  ).slice(0, 4);

  function patchLastAssistant(fn: (t: ChatTurn) => ChatTurn) {
    setTurns((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = fn(next[i]);
          break;
        }
      }
      return next;
    });
  }

  async function sendMessage(content: string) {
    if (!content.trim() || sending) return;
    const userTurn: ChatTurn = { role: "user", content: content.trim() };
    const nextTurns = [...turns, userTurn];
    setTurns([...nextTurns, { role: "assistant", content: "", streaming: true }]);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setSending(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextTurns.map((t) => ({ role: t.role, content: t.content })),
          context: pathname,
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()) as SseEvent);
          } catch {
            /* frame parcial */
          }
        }
      }
    } catch (err) {
      patchLastAssistant((t) => ({
        ...t,
        content: t.content || `${err instanceof Error ? err.message : "Erro"}`,
        isError: true,
        streaming: false,
      }));
    } finally {
      setSending(false);
      patchLastAssistant((t) => ({ ...t, streaming: false }));
    }
  }

  function handleEvent(ev: SseEvent) {
    switch (ev.type) {
      case "text_delta":
        if (ev.text) patchLastAssistant((t) => ({ ...t, content: t.content + ev.text }));
        break;
      case "tool_use":
        if (ev.name)
          patchLastAssistant((t) => {
            const steps = t.steps ? [...t.steps] : [];
            if (!steps.some((s) => s.name === ev.name))
              steps.push({ name: ev.name!, status: "running" });
            return { ...t, steps };
          });
        break;
      case "tool_result":
        if (ev.name)
          patchLastAssistant((t) => ({
            ...t,
            steps: (t.steps ?? []).map((s) =>
              s.name === ev.name ? { ...s, status: "success" } : s
            ),
          }));
        break;
      case "handoff":
        patchLastAssistant((t) => {
          const steps = t.steps ? [...t.steps] : [];
          const existing = steps.find((s) => s.name === "request_human_handoff");
          if (existing) existing.status = "success";
          else steps.push({ name: "request_human_handoff", status: "success" });
          return { ...t, steps, handoff: true };
        });
        break;
      case "done":
        patchLastAssistant((t) => ({
          ...t,
          interactionId: ev.interactionId ?? null,
          handoff: ev.handoff ?? t.handoff,
          streaming: false,
        }));
        break;
      case "error":
        patchLastAssistant((t) => ({
          ...t,
          content: t.content || `${ev.message ?? "Erro"}`,
          isError: true,
          streaming: false,
        }));
        break;
    }
  }

  async function sendFeedback(idx: number, rating: 1 | -1) {
    const turn = turns[idx];
    if (!turn?.interactionId || turn.rating) return;
    setTurns((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], rating };
      return next;
    });
    try {
      await fetch("/api/support/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: turn.interactionId, rating }),
      });
    } catch {
      /* best-effort */
    }
  }

  function reset() {
    setTurns([]);
    setInput("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-chat-panel=""
        side="right"
        className="flex w-full flex-col gap-0 bg-background p-0 sm:max-w-md"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            Assistente de suporte
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Tire dúvidas de como usar a ferramenta. Se eu não souber, encaminho ao suporte.
          </p>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 && (
            <div className="space-y-3">
              {screen.info && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                  <span className="font-medium">{screen.info.name}.</span> {screen.info.purpose}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Sugestões:</p>
              <div className="grid grid-cols-1 gap-2">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.label)}
                    className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-left text-xs transition-all hover:scale-[1.01] hover:bg-muted/60"
                  >
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, idx) =>
            t.role === "user" ? (
              <div key={idx} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  <p className="whitespace-pre-wrap break-words">{t.content}</p>
                </div>
              </div>
            ) : (
              <div key={idx} className="group flex gap-3">
                <div
                  className={cn(
                    "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    t.isError ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"
                  )}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {t.steps && t.steps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.steps.map((s, i) => (
                        <ToolChip key={i} step={s} />
                      ))}
                    </div>
                  )}

                  <div
                    className={cn(
                      "text-sm",
                      t.isError
                        ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive"
                        : ""
                    )}
                  >
                    {t.content ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.content}</ReactMarkdown>
                      </div>
                    ) : (
                      t.streaming && <ThinkingDots />
                    )}
                  </div>

                  {t.handoff && (
                    <div className="flex items-center gap-1 text-[11px] text-amber-600">
                      <LifeBuoy className="h-3 w-3" />
                      Encaminhado ao suporte humano
                    </div>
                  )}

                  {!t.streaming && t.interactionId && (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        aria-label="Resposta útil"
                        onClick={() => sendFeedback(idx, 1)}
                        disabled={!!t.rating}
                        className={cn(
                          "rounded p-1 hover:bg-muted",
                          t.rating === 1 ? "text-emerald-600" : "text-muted-foreground"
                        )}
                      >
                        <ThumbsUp className="h-3 w-3" />
                      </button>
                      <button
                        aria-label="Resposta não ajudou"
                        onClick={() => sendFeedback(idx, -1)}
                        disabled={!!t.rating}
                        className={cn(
                          "rounded p-1 hover:bg-muted",
                          t.rating === -1 ? "text-red-600" : "text-muted-foreground"
                        )}
                      >
                        <ThumbsDown className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-all focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15 hover:border-foreground/20">
            <Textarea
              ref={taRef}
              rows={1}
              placeholder="Pergunte algo…"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              disabled={sending}
              autoFocus
              className="max-h-[160px] min-h-[44px] resize-none border-0 bg-transparent px-3 py-2.5 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="flex items-center justify-between gap-2 border-t border-dashed px-2 py-1.5">
              <span className="select-none text-[10px] text-muted-foreground">Haiku · ~3s</span>
              <div className="flex items-center gap-1">
                {turns.length > 0 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={reset}
                    disabled={sending}
                    aria-label="Nova conversa"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 gap-1.5 px-3"
                  onClick={() => sendMessage(input)}
                  disabled={sending || !input.trim()}
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
