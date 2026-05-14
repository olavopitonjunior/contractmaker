"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, GitCommit, X } from "lucide-react";
import { diffLines } from "diff";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ChangeLogItem {
  id: string;
  action: string;
  summary: string;
  source: string;
  createdAt: string;
  sessionId: string | null;
  hasDiff: boolean;
  htmlBefore: string | null;
  htmlAfter: string | null;
}

interface ChangesPanelProps {
  contractId: string;
  /** Quando passado, filtra por session. Toggle "Tudo" libera. */
  sessionId: string | null;
  reloadKey: number;
  onClose: () => void;
}

/**
 * Painel "Mudanças deste chat" — lista turns que tocaram o contrato e
 * mostra diff colorido inline expansível. Usa lib `diff` client-side
 * (server só devolve htmlBefore/htmlAfter, evita cost de calcular).
 *
 * Filtro: por default mostra apenas turns da session ativa. Toggle "Tudo"
 * libera o filtro pra ver mudanças de qualquer session do contrato.
 */
export function ChangesPanel({
  contractId,
  sessionId,
  reloadKey,
  onClose,
}: ChangesPanelProps) {
  const [items, setItems] = useState<ChangeLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterAll, setFilterAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL(
      `/api/contracts/${contractId}/changes`,
      typeof window !== "undefined" ? window.location.origin : "http://localhost"
    );
    if (!filterAll && sessionId) url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("onlyDiffs", "true");
    fetch(url.toString())
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setError(data.error || "Falha ao carregar");
          return;
        }
        setItems(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId, sessionId, filterAll, reloadKey]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full w-[360px] shrink-0 border-l bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <GitCommit className="h-4 w-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-medium">Mudanças</h3>
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground">({items.length})</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label="Fechar painel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {sessionId && (
        <div className="flex items-center justify-between px-4 py-2 border-b text-xs">
          <span className="text-muted-foreground">
            {filterAll ? "Todas as sessões" : "Esta sessão"}
          </span>
          <button
            type="button"
            onClick={() => setFilterAll((v) => !v)}
            className="text-primary hover:underline"
          >
            {filterAll ? "Filtrar esta sessão" : "Ver tudo"}
          </button>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && error && (
            <p className="text-xs text-destructive text-center py-8">{error}</p>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Sem alterações registradas
              {sessionId && !filterAll ? " nesta sessão" : ""}.
            </p>
          )}
          {items.map((item) => (
            <ChangeItem
              key={item.id}
              item={item}
              expanded={expanded.has(item.id)}
              onToggle={() => toggleExpand(item.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ChangeItem({
  item,
  expanded,
  onToggle,
}: {
  item: ChangeLogItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = new Date(item.createdAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 p-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{item.action}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{time}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {item.summary}
          </p>
        </div>
      </button>
      {expanded && item.htmlBefore !== null && item.htmlAfter !== null && (
        <div className="border-t bg-muted/20 p-2">
          <DiffView before={item.htmlBefore} after={item.htmlAfter} />
        </div>
      )}
    </div>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  // diffLines retorna array de {value, added, removed}. Unchanged blocks
  // ficam discretos, added em verde, removed em vermelho strikethrough.
  const parts = diffLines(before, after, { ignoreWhitespace: false });

  // Se for muito grande, mostra apenas hunks com mudança + 2 linhas de
  // contexto pra cada lado. Senão a renderização engasga.
  const trimmed: typeof parts = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.added || p.removed) {
      trimmed.push(p);
    } else {
      const lines = p.value.split("\n");
      if (lines.length <= 4) {
        trimmed.push(p);
      } else {
        const isFirst = i === 0;
        const isLast = i === parts.length - 1;
        const head = isFirst ? "" : lines.slice(0, 2).join("\n");
        const tail = isLast ? "" : lines.slice(-2).join("\n");
        const value = [head, "…", tail].filter(Boolean).join("\n");
        trimmed.push({ ...p, value });
      }
    }
  }

  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words leading-snug">
      {trimmed.map((p, idx) => (
        <span
          key={idx}
          className={cn(
            p.added && "bg-green-500/10 text-green-900 dark:text-green-300",
            p.removed && "bg-red-500/10 text-red-900 dark:text-red-300 line-through",
            !p.added && !p.removed && "text-muted-foreground opacity-70"
          )}
        >
          {p.value}
        </span>
      ))}
    </pre>
  );
}
