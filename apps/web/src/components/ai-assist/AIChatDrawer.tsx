"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Send,
  RotateCcw,
  Wrench,
  LifeBuoy,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { describeScreen } from "@/lib/support/route-map";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  interactionId?: string | null;
  handoff?: boolean;
  rating?: 1 | -1;
  streaming?: boolean;
}

// Sugestões: as de /locacao só aparecem em telas de locação (o tenant tem o
// módulo); as de ajuda genérica aparecem em qualquer tela.
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

  const screen = describeScreen(pathname);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, sending]);

  const suggestions = SUGGESTIONS.filter(
    (s) => s.context.includes("*") || s.context.some((c) => pathname.includes(c))
  ).slice(0, 4);

  // Atualiza o último turn de assistente (o que está sendo transmitido).
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
          let ev: SseEvent;
          try {
            ev = JSON.parse(line.slice(5).trim()) as SseEvent;
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      }
    } catch (err) {
      patchLastAssistant((t) => ({
        ...t,
        content: t.content || `❌ ${err instanceof Error ? err.message : "Erro"}`,
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
          patchLastAssistant((t) => ({
            ...t,
            toolsUsed: [...new Set([...(t.toolsUsed ?? []), ev.name!])],
          }));
        break;
      case "handoff":
        patchLastAssistant((t) => ({ ...t, handoff: true }));
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
          content: t.content || `❌ ${ev.message ?? "Erro"}`,
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
      /* silencioso — feedback é best-effort */
    }
  }

  function reset() {
    setTurns([]);
    setInput("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Assistente de suporte
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Tire dúvidas de como usar a ferramenta. Se eu não souber, encaminho ao suporte.
          </p>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-4">
          {turns.length === 0 && (
            <div className="space-y-3">
              {screen.info && (
                <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                  <span className="font-medium">{screen.info.name}.</span>{" "}
                  {screen.info.purpose}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Sugestões:</p>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s.label)}
                  className="w-full rounded-md border bg-muted/40 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {turns.map((t, idx) => (
            <div
              key={idx}
              className={`rounded-md px-3 py-2 text-sm ${
                t.role === "user"
                  ? "ml-6 bg-primary text-primary-foreground"
                  : "mr-6 bg-muted"
              }`}
            >
              <div className="whitespace-pre-wrap">
                {t.content}
                {t.streaming && !t.content && (
                  <span className="inline-block animate-pulse text-muted-foreground">
                    Pensando…
                  </span>
                )}
              </div>

              {t.role === "assistant" && t.handoff && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
                  <LifeBuoy className="h-3 w-3" />
                  Encaminhado ao suporte humano
                </div>
              )}

              {t.toolsUsed && t.toolsUsed.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.toolsUsed.map((tool, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      <Wrench className="mr-1 h-2.5 w-2.5" />
                      {tool}
                    </Badge>
                  ))}
                </div>
              )}

              {t.role === "assistant" && !t.streaming && t.interactionId && (
                <div className="mt-1.5 flex items-center gap-1">
                  <button
                    aria-label="Resposta útil"
                    onClick={() => sendFeedback(idx, 1)}
                    disabled={!!t.rating}
                    className={`rounded p-1 hover:bg-background/60 ${
                      t.rating === 1 ? "text-green-600" : "text-muted-foreground"
                    }`}
                  >
                    <ThumbsUp className="h-3 w-3" />
                  </button>
                  <button
                    aria-label="Resposta não ajudou"
                    onClick={() => sendFeedback(idx, -1)}
                    disabled={!!t.rating}
                    className={`rounded p-1 hover:bg-background/60 ${
                      t.rating === -1 ? "text-red-600" : "text-muted-foreground"
                    }`}
                  >
                    <ThumbsDown className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t pt-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="flex gap-2"
          >
            <Input
              placeholder="Pergunte algo…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              autoFocus
            />
            <Button type="submit" size="sm" disabled={sending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
            {turns.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={reset} disabled={sending}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
