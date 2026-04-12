"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: string;
  content: string;
  isError?: boolean;
  retryPayload?: string;
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

  async function sendMessage(userMessage: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await res.json();

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
        const errorMsg = data.error || `Erro ${res.status}: falha ao processar mensagem.`;
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: errorMsg,
            isError: true,
            retryPayload: userMessage,
          },
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `Erro de conexão: ${err.message}`,
          isError: true,
          retryPayload: userMessage,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `temp-${Date.now()}`, role: "user", content: userMessage },
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
                  : msg.isError
                  ? "bg-destructive/10 border border-destructive/30 text-destructive-foreground mr-8"
                  : "bg-muted mr-8"
              )}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.isError && msg.retryPayload && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={loading}
                  onClick={() => handleRetry(msg.retryPayload!)}
                >
                  <RotateCw className="h-3 w-3 mr-1" />
                  Tentar novamente
                </Button>
              )}
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
          placeholder="Pergunte ou solicite alterações..."
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
