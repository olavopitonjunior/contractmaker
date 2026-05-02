"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

interface SuggestionRow {
  id: string;
  suggestionId: string;
  type: string;
  authorType: string;
  reason: string | null;
  originalText: string | null;
  newText: string | null;
  status: string;
  createdAt: string;
}

type ToolbarMode = "tiptap" | "google_docs";

interface SuggestionsToolbarProps {
  contractId: string;
  /** TipTap editor — obrigatório em mode="tiptap"; ignorado em mode="google_docs". */
  editor: Editor | null;
  version: number;
  onContentChange: (html: string) => void;
  /** Default "tiptap". Em "google_docs" o accept/reject é só DB+Drive. */
  mode?: ToolbarMode;
}

export function SuggestionsToolbar({
  contractId,
  editor,
  version,
  onContentChange,
  mode = "tiptap",
}: SuggestionsToolbarProps) {
  const [pending, setPending] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/suggestions?status=pending`);
      if (res.ok) setPending(await res.json());
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function resolveAll(action: "accept" | "reject") {
    if (pending.length === 0) return;

    if (mode === "tiptap") {
      if (!editor) return;
      for (const row of pending) {
        if (action === "accept") {
          editor.chain().focus().acceptSuggestion(row.suggestionId).run();
        } else {
          editor.chain().focus().rejectSuggestion(row.suggestionId).run();
        }
      }
      const newHtml = editor.getHTML();
      onContentChange(newHtml);
      await Promise.all(
        pending.map((row) =>
          fetch(`/api/contracts/${contractId}/suggestions/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, htmlContent: newHtml }),
          })
        )
      );
    } else {
      // GDocs: server aplica replaceAllText/insertText/deleteContentRange direto
      // no doc; cliente só informa a ação.
      await Promise.all(
        pending.map((row) =>
          fetch(`/api/contracts/${contractId}/suggestions/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          })
        )
      );
    }

    toast.success(
      action === "accept"
        ? `${pending.length} sugestões aceitas`
        : `${pending.length} sugestões rejeitadas`
    );
    load();
  }

  async function resolveOne(row: SuggestionRow, action: "accept" | "reject") {
    setResolvingId(row.id);
    try {
      if (mode === "tiptap" && editor) {
        if (action === "accept") {
          editor.chain().focus().acceptSuggestion(row.suggestionId).run();
        } else {
          editor.chain().focus().rejectSuggestion(row.suggestionId).run();
        }
        const newHtml = editor.getHTML();
        onContentChange(newHtml);
        await fetch(`/api/contracts/${contractId}/suggestions/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, htmlContent: newHtml }),
        });
      } else {
        await fetch(`/api/contracts/${contractId}/suggestions/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
      }
      toast.success(action === "accept" ? "Sugestão aceita" : "Sugestão rejeitada");
      load();
    } finally {
      setResolvingId(null);
    }
  }

  if (loading && pending.length === 0) return null;
  if (pending.length === 0) return null;

  return (
    <div className="sticky top-[72px] z-20 border-b bg-amber-50 dark:bg-amber-950/20">
      <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="gap-1">
          <Sparkles className="h-3 w-3" />
          {pending.length} {pending.length === 1 ? "sugestão pendente" : "sugestões pendentes"}
        </Badge>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {mode === "google_docs"
            ? "Aceitar aplica direto no Google Doc · refresh do iframe pode levar alguns segundos"
            : "Revise antes de aprovar o contrato"}
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" />
                Ocultar
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                Detalhes
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-green-700 hover:text-green-800 hover:bg-green-100"
            onClick={() => resolveAll("accept")}
          >
            <Check className="h-3 w-3 mr-1" />
            Aceitar todas
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-red-100"
            onClick={() => resolveAll("reject")}
          >
            <X className="h-3 w-3 mr-1" />
            Rejeitar todas
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 max-h-[40vh] overflow-y-auto">
          {pending.map((row) => (
            <div
              key={row.id}
              className="rounded-md border border-amber-200 bg-white dark:bg-card p-2 text-xs space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] h-4 capitalize">
                  {row.type}
                </Badge>
                <span className="text-muted-foreground">{row.authorType === "ai" ? "IA" : "Usuário"}</span>
              </div>
              {row.originalText && (
                <div className="text-[11px]">
                  <span className="text-red-700">−</span>{" "}
                  <span className="line-through text-muted-foreground">
                    {row.originalText.slice(0, 200)}
                    {row.originalText.length > 200 ? "…" : ""}
                  </span>
                </div>
              )}
              {row.newText && (
                <div className="text-[11px]">
                  <span className="text-green-700">+</span>{" "}
                  <span className="text-foreground">
                    {row.newText.slice(0, 200)}
                    {row.newText.length > 200 ? "…" : ""}
                  </span>
                </div>
              )}
              {row.reason && (
                <p className="text-[10px] italic text-muted-foreground">
                  Motivo: {row.reason}
                </p>
              )}
              <div className="flex gap-1 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] text-green-700"
                  disabled={resolvingId === row.id}
                  onClick={() => resolveOne(row, "accept")}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Aceitar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] text-destructive"
                  disabled={resolvingId === row.id}
                  onClick={() => resolveOne(row, "reject")}
                >
                  <X className="h-3 w-3 mr-1" />
                  Rejeitar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
