"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: string;
  content: string;
}

interface ChatPanelProps {
  contractId: string;
  messages: Message[];
  onContentUpdate?: (html: string) => void;
}

export function ChatPanel({ contractId, messages: initialMessages, onContentUpdate }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);

    setMessages((prev) => [
      ...prev,
      { id: `temp-${Date.now()}`, role: "user", content: userMessage },
    ]);

    const res = await fetch(`/api/contracts/${contractId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessage }),
    });

    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: data.message || data.assistantText || "Feito!",
        },
      ]);

      if (data.htmlContent && onContentUpdate) {
        onContentUpdate(data.htmlContent);
      }
    } else {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: "Erro ao processar mensagem." },
      ]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-120px)]">
      <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
        <div className="space-y-4 py-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Envie uma mensagem para editar o contrato com IA.
              <br />
              Ex: "Altere o valor do sinal para R$ 80.000"
            </p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "rounded-lg p-3 text-sm",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground ml-8"
                  : "bg-muted mr-8"
              )}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))}
          {loading && (
            <div className="bg-muted rounded-lg p-3 mr-8">
              <p className="text-sm text-muted-foreground animate-pulse">
                Pensando...
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t pt-4 flex gap-2">
        <Input
          placeholder="Pergunte ou solicite alteracoes..."
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
  );
}
