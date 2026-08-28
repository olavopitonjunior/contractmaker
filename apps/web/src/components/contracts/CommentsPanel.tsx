"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Check, MessageSquare, Trash2, Send, Bot, User as UserIcon, AlertTriangle, Plus, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AiResolveDialog } from "./AiResolveDialog";

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
  /** Quando definido, mostra botão "Novo comentário" no header. Em GDocs o
   *  parent abre AddCommentDialog com `requireSelectedTextInput`. */
  onAddComment?: () => void;
  /** Quando true, esconde o botão "Resolver com IA" (contrato aprovado é
   *  imutável). Default false (mostra). */
  isApproved?: boolean;
  /** Callback chamado quando a IA aplica uma correção via dialog. Usado pra
   *  refrescar o conteúdo do iframe Google Docs. */
  onContentUpdate?: (html: string) => void;
  /** Chamado quando a revisão sob demanda termina (badge do header refresca). */
  onReviewFinished?: () => void;
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
  onAddComment,
  isApproved = false,
  onContentUpdate,
  onReviewFinished,
}: CommentsPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [aiResolveTarget, setAiResolveTarget] = useState<Comment | null>(null);
  const [reviewing, setReviewing] = useState(false);

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
    // Dependência pré-existente à adoção do ESLint (#374). Incluir `load` muda
    // quando o efeito redispara; não foi avaliado neste PR de higiene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /**
   * "Revisar com IA": a revisão automática roda na geração; depois de edições
   * manuais no Doc o operador pede outra por aqui. O servidor reusa run vivo
   * (clicar duas vezes não paga duas revisões); o poll acompanha até o fim e
   * recarrega a lista — os apontamentos novos chegam como comentários.
   */
  async function startReview() {
    setReviewing(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/review`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Não foi possível iniciar a revisão");
        setReviewing(false);
        return;
      }
      toast.success("Revisão iniciada — os apontamentos chegam em instantes");
      const runId: string = body.runId;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const poll = await fetch(`/api/contracts/${contractId}/review`);
        if (!poll.ok) continue;
        const { run } = await poll.json();
        if (!run || run.id !== runId) continue;
        if (run.status === "done") {
          toast.success("Revisão concluída");
          break;
        }
        if (run.status === "failed") {
          toast.error("A revisão falhou — tente novamente mais tarde");
          break;
        }
        if (run.status === "skipped") {
          toast.info("Revisão não se aplica a este contrato agora");
          break;
        }
      }
      await load();
      onReviewFinished?.();
    } catch {
      toast.error("Não foi possível iniciar a revisão");
    } finally {
      setReviewing(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;
  }

  const headerCta =
    onAddComment || !isApproved ? (
      <div className="px-4 pt-2 pb-1 flex gap-2">
        {onAddComment ? (
          <Button size="sm" variant="outline" className="flex-1" onClick={onAddComment}>
            <Plus className="h-4 w-4 mr-1" />
            Novo comentário
          </Button>
        ) : null}
        {!isApproved ? (
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={startReview}
            disabled={reviewing}
          >
            {reviewing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1" />
            )}
            {reviewing ? "Revisando…" : "Revisar com IA"}
          </Button>
        ) : null}
      </div>
    ) : null;

  if (comments.length === 0) {
    return (
      <>
        {headerCta}
        <div className="flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
          <MessageSquare className="h-10 w-10 mb-3 opacity-50" />
          <p className="text-sm">Nenhum comentário ainda</p>
          <p className="text-xs mt-1">
            {onAddComment
              ? "Clique em Novo comentário acima para criar o primeiro"
              : "Selecione um trecho no editor e clique em Comentar"}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {headerCta}
      <ScrollArea className="h-[calc(100vh-10rem)]">
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
                className="flex flex-wrap gap-1 pt-1"
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
                {c.authorType === "ai" && !isApproved && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-purple-600 hover:text-purple-700"
                    onClick={() => setAiResolveTarget(c)}
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    Resolver com IA
                  </Button>
                )}
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
      <AiResolveDialog
        open={!!aiResolveTarget}
        contractId={contractId}
        comment={
          aiResolveTarget
            ? {
                id: aiResolveTarget.id,
                text: aiResolveTarget.text,
                selectedText: aiResolveTarget.selectedText,
                severity: aiResolveTarget.severity,
              }
            : null
        }
        onClose={() => setAiResolveTarget(null)}
        onContentUpdate={onContentUpdate}
        onSuccess={() => {
          toast.success("Correção aplicada pela IA");
          onCommentResolved?.(aiResolveTarget?.anchorId || "");
          load();
        }}
      />
    </>
  );
}
