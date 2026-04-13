"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Check, MessageSquare, Trash2, Send, Bot, User as UserIcon, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface Comment {
  id: string;
  authorName: string;
  authorType: string;
  text: string;
  anchorId: string;
  selectedText: string;
  severity: string;
  resolved: boolean;
  createdAt: string;
  replies?: Comment[];
}

interface CommentsPanelProps {
  contractId: string;
  onCommentClick?: (anchorId: string) => void;
  onCommentResolved?: (anchorId: string) => void;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const delta = Math.floor((now - d.getTime()) / 1000);
  if (delta < 60) return "agora";
  if (delta < 3600) return `${Math.floor(delta / 60)}min`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return d.toLocaleDateString("pt-BR");
}

export function CommentsPanel({
  contractId,
  onCommentClick,
  onCommentResolved,
}: CommentsPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch {
      toast.error("Erro ao carregar comentários");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [contractId]);

  async function resolve(id: string, anchorId: string) {
    const res = await fetch(`/api/contracts/${contractId}/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    if (res.ok) {
      toast.success("Comentário resolvido");
      onCommentResolved?.(anchorId);
      load();
    } else {
      toast.error("Erro ao resolver");
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/contracts/${contractId}/comments/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Comentário removido");
      load();
    }
  }

  async function reply(parentId: string) {
    if (!replyText.trim()) return;
    const res = await fetch(`/api/contracts/${contractId}/comments/${parentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText }),
    });
    if (res.ok) {
      setReplyText("");
      setReplyingTo(null);
      load();
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;
  }

  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
        <MessageSquare className="h-10 w-10 mb-3 opacity-50" />
        <p className="text-sm">Nenhum comentário ainda</p>
        <p className="text-xs mt-1">
          Selecione um trecho no editor e clique em Comentar
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-8rem)]">
      <div className="space-y-3 p-4">
        {comments.map((c) => (
          <div
            key={c.id}
            className="rounded-md border bg-card p-3 space-y-2 cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => onCommentClick?.(c.anchorId)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {c.authorType === "ai" ? (
                  <Bot className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="text-xs font-medium truncate">{c.authorName}</span>
                <span className="text-xs text-muted-foreground">{formatRelative(c.createdAt)}</span>
              </div>
              {c.severity !== "info" && (
                <Badge
                  variant={c.severity === "error" ? "destructive" : "secondary"}
                  className="text-[10px] h-5"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {c.severity}
                </Badge>
              )}
            </div>

            <blockquote className="text-xs italic text-muted-foreground border-l-2 border-muted pl-2 line-clamp-2">
              {c.selectedText}
            </blockquote>

            <p className="text-sm whitespace-pre-wrap">{c.text}</p>

            {c.replies && c.replies.length > 0 && (
              <div className="space-y-2 pl-3 border-l-2 border-muted mt-2">
                {c.replies.map((r) => (
                  <div key={r.id} className="text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span className="font-medium">{r.authorName}</span>
                      <span>·</span>
                      <span>{formatRelative(r.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap mt-0.5">{r.text}</p>
                  </div>
                ))}
              </div>
            )}

            {replyingTo === c.id ? (
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Responder…"
                  className="text-xs min-h-[60px]"
                />
                <div className="flex gap-1">
                  <Button size="sm" className="h-7" onClick={() => reply(c.id)}>
                    <Send className="h-3 w-3 mr-1" />
                    Enviar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => {
                      setReplyingTo(null);
                      setReplyText("");
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="flex gap-1 pt-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setReplyingTo(c.id)}
                >
                  Responder
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-green-600 hover:text-green-700"
                  onClick={() => resolve(c.id, c.anchorId)}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Resolver
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={() => remove(c.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
