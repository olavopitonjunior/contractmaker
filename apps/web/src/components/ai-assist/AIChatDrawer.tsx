"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, RotateCcw, Wrench } from "lucide-react";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
}

const SUGGESTIONS: Array<{ context: string[]; label: string }> = [
  { context: ["/locacao"], label: "Como está minha inadimplência este mês?" },
  { context: ["/locacao"], label: "Quem são os 3 maiores devedores?" },
  { context: ["/locacao/contratos/"], label: "Resumo deste contrato" },
  { context: ["/locacao/contratos/"], label: "Sugerir estratégia de cobrança" },
  { context: ["/locacao/imoveis/"], label: "Resumo deste imóvel" },
  { context: ["/locacao/pessoas/proprietarios/"], label: "Extrato do proprietário" },
  { context: ["/locacao/repasses"], label: "Projete fluxo de caixa pros próximos 3 meses" },
  { context: ["*"], label: "O que preciso fazer hoje na minha imobiliária?" },
];

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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, sending]);

  const suggestions = SUGGESTIONS.filter(
    (s) => s.context.includes("*") || s.context.some((c) => pathname.includes(c))
  ).slice(0, 4);

  async function sendMessage(content: string) {
    if (!content.trim() || sending) return;
    const userTurn: ChatTurn = { role: "user", content: content.trim() };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
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
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { reply: string; toolsUsed?: string[] };
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, toolsUsed: data.toolsUsed },
      ]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `❌ ${err instanceof Error ? err.message : "Erro"}`,
        },
      ]);
    } finally {
      setSending(false);
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
            Assistente IA
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Pergunte sobre contratos, cobranças, fluxo de caixa ou sugestões de ação. Usa Haiku 4.5.
          </p>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-4">
          {turns.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Sugestões pra esta tela:</p>
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
              <div className="whitespace-pre-wrap">{t.content}</div>
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
            </div>
          ))}
          {sending && (
            <div className="mr-6 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <span className="inline-block animate-pulse">Pensando…</span>
            </div>
          )}
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
          <p className="text-[10px] text-muted-foreground">
            Contexto atual: <code>{pathname}</code>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
