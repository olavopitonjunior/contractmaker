"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  Menu,
  X,
  Paperclip,
  Link2,
  FileText,
  Globe,
  GitCommit,
  Copy,
  Check,
  Sparkles,
  ScrollText,
  AlertTriangle,
  ListChecks,
  Pencil,
  Maximize2,
  Minimize2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Dialog as SheetPrimitive } from "radix-ui";
import { useResizableSheet } from "@/components/ui/resizable-sheet";
import { cn } from "@/lib/utils";
import type { AgentEvent, AgentMode } from "@/lib/ai/types";
import { describeTool, KIND_CLASSES } from "@/lib/ai/event-icons";
import { ChatSessionSidebar } from "./ChatSessionSidebar";
import { ChangesPanel } from "./ChangesPanel";
import { PlanCard } from "./PlanCard";

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

interface ChatAttachment {
  id: string;
  name: string;
  source: "upload" | "url";
  sourceUrl?: string;
  extractedChars?: number;
  loading?: boolean;
}

interface ChatPanelProps {
  contractId: string;
  messages: Message[];
  onContentUpdate?: (html: string) => void;
  /** Disparado a cada turn que termina com sucesso (evento `done`). */
  onChatTurnComplete?: () => void;
  initialInput?: string;
  /** Session inicial (do prop messages). UI deixa o usuário trocar via sidebar. */
  initialSessionId?: string | null;
}

export function ChatPanel({
  contractId,
  messages: initialMessages,
  onContentUpdate,
  onChatTurnComplete,
  initialInput,
  initialSessionId,
}: ChatPanelProps) {
  const { fullscreen, toggleFullscreen, canToggleFullscreen } = useResizableSheet();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState(initialInput ?? "");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<AgentMode>("plan");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarReloadKey, setSidebarReloadKey] = useState(0);
  const [switchingSession, setSwitchingSession] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [urlPopoverOpen, setUrlPopoverOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [changesPanelOpen, setChangesPanelOpen] = useState(false);
  const [changesReloadKey, setChangesReloadKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track container width pra decidir layout responsivo do ChangesPanel
  // (overlay quando estreito) e auto-fechar sidebar quando 2 painéis nao
  // cabem juntos. ResizeObserver no root garante reactivity ao drag handle
  // do ResizableSheet sem dependência de window.innerWidth.
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  useEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setContainerWidth(w);
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);
  // Auto-fecha sidebar quando ChangesPanel abre e nao ha espaço pros dois
  // (sidebar 220 + changes panel 360 + chat min ~280 = 860). Threshold 800
  // dispara o fechamento.
  useEffect(() => {
    if (changesPanelOpen && containerWidth < 800 && sidebarOpen) {
      setSidebarOpen(false);
    }
  }, [changesPanelOpen, containerWidth, sidebarOpen]);
  const changesPanelFloating = containerWidth < 700;

  /**
   * Garante que há uma session ativa antes de anexar — anexos vivem dentro
   * de uma session. Se ainda nao existe (primeira mensagem do contrato),
   * cria uma via POST /chat-sessions e retorna o id.
   */
  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    try {
      const res = await fetch(`/api/contracts/${contractId}/chat-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      setSessionId(data.id);
      setSidebarReloadKey((k) => k + 1);
      return data.id;
    } catch {
      return null;
    }
  }

  async function handleUploadFile(file: File) {
    setAttachmentError(null);
    const sid = await ensureSession();
    if (!sid) {
      setAttachmentError("Nao foi possivel criar uma sessao");
      return;
    }
    if (attachments.length >= 5) {
      setAttachmentError("Maximo 5 anexos por turn");
      return;
    }
    setAttaching(true);
    const tempId = `tmp-${Date.now()}`;
    setAttachments((prev) => [
      ...prev,
      { id: tempId, name: file.name, source: "upload", loading: true },
    ]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sessionId", sid);
      const res = await fetch(`/api/contracts/${contractId}/chat-attachments`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setAttachments((prev) => prev.filter((a) => a.id !== tempId));
        setAttachmentError(data.error || "Falha ao anexar");
        return;
      }
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === tempId
            ? {
                id: data.id,
                name: data.name,
                source: data.source,
                extractedChars: data.extractedChars,
              }
            : a
        )
      );
    } catch (err) {
      setAttachments((prev) => prev.filter((a) => a.id !== tempId));
      setAttachmentError(err instanceof Error ? err.message : "Falha ao anexar");
    } finally {
      setAttaching(false);
    }
  }

  async function handleAttachUrl() {
    const raw = urlInput.trim();
    if (!raw) return;
    setAttachmentError(null);
    const sid = await ensureSession();
    if (!sid) {
      setAttachmentError("Nao foi possivel criar uma sessao");
      return;
    }
    if (attachments.length >= 5) {
      setAttachmentError("Maximo 5 anexos por turn");
      return;
    }
    setAttaching(true);
    const tempId = `tmp-${Date.now()}`;
    setAttachments((prev) => [
      ...prev,
      { id: tempId, name: raw, source: "url", loading: true },
    ]);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/chat-attachments/url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, url: raw }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setAttachments((prev) => prev.filter((a) => a.id !== tempId));
        setAttachmentError(data.error || "Falha ao buscar URL");
        return;
      }
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === tempId
            ? {
                id: data.id,
                name: data.name,
                source: data.source,
                sourceUrl: data.sourceUrl,
                extractedChars: data.extractedChars,
              }
            : a
        )
      );
      setUrlInput("");
      setUrlPopoverOpen(false);
    } catch (err) {
      setAttachments((prev) => prev.filter((a) => a.id !== tempId));
      setAttachmentError(err instanceof Error ? err.message : "Falha ao buscar URL");
    } finally {
      setAttaching(false);
    }
  }

  async function handleRemoveAttachment(id: string) {
    // Remove otimisticamente — server delete e best-effort.
    const target = attachments.find((a) => a.id === id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    if (target && !id.startsWith("tmp-")) {
      try {
        await fetch(
          `/api/contracts/${contractId}/chat-attachments/${id}`,
          { method: "DELETE" }
        );
      } catch {
        // ignora — UI ja removeu, dangling row no DB nao machuca
      }
    }
  }

  // Quando o usuário troca de session via sidebar, busca as mensagens
  // daquela session e troca o state local (não persiste optimisticamente).
  async function switchToSession(newSessionId: string) {
    if (newSessionId === sessionId || switchingSession) return;
    setSwitchingSession(true);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/chat-sessions/${newSessionId}`
      );
      if (!res.ok) throw new Error("load_failed");
      const data = await res.json();
      setMessages(
        (data.messages || []).map((m: { id: string; role: string; content: string; events?: AgentEvent[] | null }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          events: m.events || undefined,
        }))
      );
      setSessionId(newSessionId);
      setSidebarOpen(false);
    } catch {
      // toast handled inside fetch fallback
    } finally {
      setSwitchingSession(false);
    }
  }

  // "Nova sessão" criada via sidebar — limpa mensagens e foca no input.
  function handleNewSession(newSessionId: string) {
    setMessages([]);
    setSessionId(newSessionId);
    setSidebarOpen(false);
  }

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
        body: JSON.stringify({
          message: userMessage,
          mode,
          ...(sessionId ? { sessionId } : {}),
          ...(attachments.length > 0
            ? {
                attachmentIds: attachments
                  .filter((a) => !a.loading && !a.id.startsWith("tmp-"))
                  .map((a) => a.id),
              }
            : {}),
        }),
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
            // Re-busca sidebar pra refletir nova msgCount e auto-title da 1ª msg
            setSidebarReloadKey((k) => k + 1);
            // Re-busca painel de mudanças — turn que terminou pode ter editado
            // o doc e gerado novas ChangeLog entries com snapshots.
            setChangesReloadKey((k) => k + 1);
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
    if (attaching) return; // espera anexos terminarem
    const userMessage = input.trim();
    const attached = attachments;
    setInput("");
    // Anexos viajam UMA vez por turn — limpa o chip rack apos enviar.
    // O texto extraido fica no DB e pode ser referenciado em turns futuros
    // se o usuario re-anexar (DELETE limpa de vez).
    setAttachments([]);
    // Prefix visual na mensagem do user: lista compacta de anexos enviados.
    const attachmentNote =
      attached.length > 0
        ? attached.map((a) => `${a.source === "url" ? "🔗" : "📄"} ${a.name}`).join("  ")
        : "";
    const displayContent = attachmentNote
      ? `${attachmentNote}\n\n${userMessage}`
      : userMessage;
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: displayContent },
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
      {/* Root: relative pra ChangesPanel overlay em widths apertados.
          overflow-hidden previne leak quando flex-1 do main fica esmagado.
          rootRef monitora width via ResizeObserver pra responsividade. */}
      <div ref={rootRef} className="relative flex h-full overflow-hidden">
        {/* Sidebar — coluna estrutural que entra/sai com width animada. */}
        <div
          className={cn(
            "shrink-0 transition-all duration-200 overflow-hidden border-r",
            sidebarOpen ? "w-[220px]" : "w-0 border-r-0"
          )}
        >
          <ChatSessionSidebar
            contractId={contractId}
            activeSessionId={sessionId}
            onSelect={switchToSession}
            onCreate={handleNewSession}
            reloadKey={sidebarReloadKey}
          />
        </div>

        {/* Main — sem padding lateral próprio; cada filho declara o seu.
            Garante regra única "16px breathing room" via px-4 em header/scroll/input. */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Header h-12 com padding consistente px-3. 3 zonas: structural |
              center (mode) | meta. Título oculto em <640px pra evitar truncate. */}
          <div className="flex h-12 shrink-0 items-center gap-2 px-3 border-b">
            <div className="flex items-center gap-1 min-w-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setSidebarOpen((v) => !v)}
                    aria-label={sidebarOpen ? "Fechar sessões" : "Abrir sessões"}
                  >
                    {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {sidebarOpen ? "Fechar sessões" : "Sessões"}
                </TooltipContent>
              </Tooltip>
              <h2 className="text-sm font-semibold truncate ml-1 hidden md:block">
                Assistente Jurídico
              </h2>
            </div>

            <div className="flex-1 flex justify-center">
              <ModeToggle mode={mode} onChange={setMode} disabled={loading} />
            </div>

            {/* Cluster direita com pr-0 (já tem padding do header). gap-0.5
                aproxima os 3 ícones formando um agrupamento óbvio. */}
            <div className="flex items-center gap-0.5 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={changesPanelOpen ? "secondary" : "ghost"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setChangesPanelOpen((v) => !v)}
                    aria-label="Mostrar mudanças"
                  >
                    <GitCommit className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Mudanças deste chat</TooltipContent>
              </Tooltip>
              {canToggleFullscreen && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={toggleFullscreen}
                      aria-label={fullscreen ? "Sair de tela cheia" : "Tela cheia"}
                    >
                      {fullscreen ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {fullscreen ? "Sair de tela cheia" : "Tela cheia"}
                  </TooltipContent>
                </Tooltip>
              )}
              <SheetPrimitive.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </SheetPrimitive.Close>
            </div>
          </div>

          {switchingSession && (
            <div className="flex items-center justify-center py-3 shrink-0">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-xs text-muted-foreground">
                Carregando sessão…
              </span>
            </div>
          )}

          {/* ScrollArea ocupa o restante do main; px-4 dá breathing room
              lateral consistente, pr-1 mantém gutter do scrollbar. */}
          <ScrollArea className="flex-1 min-h-0 px-4" ref={scrollRef}>
            <div className="space-y-4 py-4 pr-1">
              {messages.length === 0 && !switchingSession && (
                <EmptyState
                  mode={mode}
                  onPickPrompt={(p) => setInput(p)}
                  disabled={loading}
                />
              )}
              {messages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  loading={loading}
                  onRetry={handleRetry}
                  contractId={contractId}
                  onPlanExecuted={() => {
                    setChangesReloadKey((k) => k + 1);
                    onChatTurnComplete?.();
                  }}
                />
              ))}
            </div>
          </ScrollArea>

          {/* Input supercard — Lovable-style. Card unico com chips de anexo
              no topo, textarea multi-line no meio, toolbar (anexos esquerda /
              model centro / Enviar direita) no rodape. px-4 pt-3 pb-4 garante
              breathing room consistente nas 4 bordas do main. */}
          <div className="shrink-0 px-4 pt-3 pb-4">
            {attachmentError && (
              <p className="text-xs text-destructive px-1 pb-2">{attachmentError}</p>
            )}
            <div className="rounded-xl border border-border bg-card shadow-sm transition-all duration-150 hover:border-foreground/20 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15 overflow-hidden">
            {attachments.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border bg-muted/60 pl-2 pr-1 py-0.5 text-xs",
                      a.loading && "opacity-60"
                    )}
                    title={
                      a.source === "url" && a.sourceUrl
                        ? a.sourceUrl
                        : a.extractedChars
                          ? `${a.extractedChars} chars extraídos`
                          : undefined
                    }
                  >
                    {a.source === "url" ? (
                      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="max-w-[180px] truncate">{a.name}</span>
                    {a.loading ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(a.id)}
                        className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                        aria-label="Remover anexo"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            <Textarea
              placeholder={
                mode === "fast"
                  ? "Edição rápida — Haiku · ~3s"
                  : "Pergunte ou planeje uma alteração…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={1}
              className="min-h-[44px] max-h-[200px] resize-none border-0 shadow-none px-3 py-2.5 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
            />

            <div className="flex items-center justify-between gap-2 border-t border-dashed px-2 py-1.5">
              <div className="flex items-center gap-0.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadFile(file);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading || attaching || attachments.length >= 5}
                      aria-label="Anexar PDF/DOCX"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Anexar PDF/DOCX (max 5MB)</TooltipContent>
                </Tooltip>
                <Popover open={urlPopoverOpen} onOpenChange={setUrlPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      disabled={loading || attaching || attachments.length >= 5}
                      aria-label="Anexar URL"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-80">
                    <div className="space-y-2">
                      <p className="text-xs font-medium">Anexar URL</p>
                      <p className="text-xs text-muted-foreground">
                        Buscamos o texto da página e enviamos junto com sua mensagem.
                      </p>
                      <Input
                        placeholder="https://..."
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAttachUrl();
                          }
                        }}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setUrlInput("");
                            setUrlPopoverOpen(false);
                          }}
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleAttachUrl}
                          disabled={!urlInput.trim() || attaching}
                        >
                          {attaching ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Anexar"
                          )}
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <span className="text-[10px] text-muted-foreground select-none">
                {mode === "fast" ? "Haiku · ~3s" : "Sonnet · ~20s"}
              </span>

              <Button
                size="sm"
                onClick={handleSend}
                disabled={loading || attaching || !input.trim()}
                className="h-7 px-3 gap-1.5"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    Enviar
                    <Send className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
        </div>

        {changesPanelOpen && (
          <ChangesPanel
            contractId={contractId}
            sessionId={sessionId}
            reloadKey={changesReloadKey}
            onClose={() => setChangesPanelOpen(false)}
            floating={changesPanelFloating}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

// ============================================
// SUB-COMPONENTES
// ============================================

/**
 * ModeToggle — segmented control Rápido/Planejar. Pill arredondado com
 * indicador deslizante. Substitui dois Button outline/default. Tooltip
 * detalha o que cada modo faz.
 */
function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: AgentMode;
  onChange: (m: AgentMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full bg-muted p-1"
      role="tablist"
      aria-label="Modo do assistente"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "fast"}
            disabled={disabled}
            onClick={() => onChange("fast")}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 h-7 text-xs font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              mode === "fast"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Rápido</span>
          </button>
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
          <button
            type="button"
            role="tab"
            aria-selected={mode === "plan"}
            disabled={disabled}
            onClick={() => onChange("plan")}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 h-7 text-xs font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              mode === "plan"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Brain className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Planejar</span>
          </button>
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
  contractId,
  onPlanExecuted,
}: {
  msg: Message;
  loading: boolean;
  onRetry: (payload: string) => void;
  contractId: string;
  onPlanExecuted?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard pode estar bloqueado em iframe — silencia
    }
  }

  if (msg.role === "user") {
    return (
      <div className="flex justify-end ml-10">
        <div className="rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 text-sm max-w-[85%]">
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3 mr-10">
      <div
        className={cn(
          "h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-1",
          msg.isError
            ? "bg-destructive/15 text-destructive"
            : "bg-primary/10 text-primary"
        )}
        aria-hidden="true"
      >
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "rounded-lg text-sm",
            msg.isError
              ? "bg-destructive/10 border border-destructive/30 p-3"
              : msg.events && msg.events.length > 0
                ? "bg-muted/40 p-3"
                : "p-0"
          )}
        >
          <EventTimeline events={msg.events} streaming={!!msg.streaming} />
          {msg.content && (
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none leading-relaxed",
                "prose-p:my-2 prose-p:leading-relaxed",
                "prose-headings:mt-3 prose-headings:mb-1.5",
                "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
                "prose-code:before:content-none prose-code:after:content-none",
                "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[12.5px]",
                "prose-pre:my-2 prose-pre:p-2 prose-pre:text-xs",
                "prose-strong:text-foreground",
                msg.events && msg.events.length > 0 && "mt-2"
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          )}
          {!msg.content && msg.streaming && <ThinkingDots />}
        </div>

        {/* PlanCard — quando o turn produziu propose_plan event, renderiza
            o card com reads ✓ + writes pendentes pra aprovacao humana. */}
        {(() => {
          const planEvt = msg.events?.find((e) => e.type === "plan_proposed");
          if (!planEvt || planEvt.type !== "plan_proposed") return null;
          return (
            <PlanCard
              contractId={contractId}
              planId={planEvt.planId}
              steps={planEvt.steps}
              onExecuted={onPlanExecuted}
            />
          );
        })()}

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

        {/* Hover actions — só pra mensagens AI completas (não streaming, não erro) */}
        {!msg.isError && !msg.streaming && msg.content && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mt-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-sm p-1 hover:bg-muted-foreground/10 text-muted-foreground"
                  aria-label="Copiar resposta"
                >
                  {copied ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{copied ? "Copiado" : "Copiar"}</TooltipContent>
            </Tooltip>
            {msg.retryPayload && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onRetry(msg.retryPayload!)}
                    disabled={loading}
                    className="rounded-sm p-1 hover:bg-muted-foreground/10 text-muted-foreground disabled:opacity-50"
                    aria-label="Retentar"
                  >
                    <RotateCw className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Refazer este turn</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 3 dots animation pra indicar que a IA esta processando antes do primeiro
 * text_delta chegar. Substitui o "Pensando..." italico textual.
 */
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Pensando">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

// ============================================
// EMPTY STATE — prompts canonicos
// ============================================

const CANONICAL_PROMPTS: Array<{
  icon: typeof ListChecks;
  label: string;
  prompt: string;
}> = [
  {
    icon: ListChecks,
    label: "Validar contrato",
    prompt: "Valide este contrato e liste os problemas encontrados, separados por gravidade.",
  },
  {
    icon: AlertTriangle,
    label: "Buscar contradições",
    prompt: "Analise possíveis contradições internas entre as cláusulas do contrato.",
  },
  {
    icon: ScrollText,
    label: "Resumir cláusulas",
    prompt: "Liste cada cláusula do contrato com número, título em negrito e resumo de 1-2 linhas.",
  },
  {
    icon: Pencil,
    label: "Sugerir melhorias",
    prompt: "Sugira melhorias para tornar este contrato mais claro e juridicamente seguro, sem alterar o doc.",
  },
];

function EmptyState({
  mode,
  onPickPrompt,
  disabled,
}: {
  mode: AgentMode;
  onPickPrompt: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Sparkles className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold">Como posso ajudar com este contrato?</h3>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-[300px] leading-relaxed">
        {mode === "fast"
          ? "Modo rápido — edição direta no Google Docs em ~3s."
          : "Modo planejamento — análise profunda com expert context."}
      </p>
      <div className="grid grid-cols-2 gap-2 mt-6 w-full max-w-sm">
        {CANONICAL_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={disabled}
            onClick={() => onPickPrompt(p.prompt)}
            className={cn(
              "flex items-start gap-2 rounded-lg border bg-card px-3 py-3 text-left text-xs",
              "hover:bg-muted/60 hover:scale-[1.02] transition-all",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            )}
          >
            <p.icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <span className="leading-tight">{p.label}</span>
          </button>
        ))}
      </div>
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
