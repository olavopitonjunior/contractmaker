"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Sparkles } from "lucide-react";
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

interface SuggestionsToolbarProps {
  contractId: string;
  editor: Editor | null;
  version: number;
  onContentChange: (html: string) => void;
}

export function SuggestionsToolbar({
  contractId,
  editor,
  version,
  onContentChange,
}: SuggestionsToolbarProps) {
  const [pending, setPending] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);

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
    if (!editor || pending.length === 0) return;
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
    toast.success(
      action === "accept"
        ? `${pending.length} sugestões aceitas`
        : `${pending.length} sugestões rejeitadas`
    );
    load();
  }

  if (loading && pending.length === 0) return null;
  if (pending.length === 0) return null;

  return (
    <div className="sticky top-[72px] z-20 border-b bg-amber-50 dark:bg-amber-950/20 px-4 py-2 flex items-center gap-2 flex-wrap">
      <Badge variant="secondary" className="gap-1">
        <Sparkles className="h-3 w-3" />
        {pending.length} {pending.length === 1 ? "sugestão pendente" : "sugestões pendentes"}
      </Badge>
      <span className="text-xs text-muted-foreground hidden sm:inline">
        Revise antes de aprovar o contrato
      </span>
      <div className="ml-auto flex gap-1">
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
  );
}

