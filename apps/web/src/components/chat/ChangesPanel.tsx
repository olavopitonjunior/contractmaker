"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, GitCommit, X } from "lucide-react";
import { diffLines } from "diff";
import { Badge } from "@/components/ui/badge";
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
  /** name || email do autor; null quando a entry não tem userId. */
  userName?: string | null;
}

interface ChangesPanelProps {
  contractId: string;
  /** Quando passado, filtra por session. Toggle "Tudo" libera. */
  sessionId: string | null;
  reloadKey: number;
  onClose: () => void;
  /** Renderiza como overlay absoluto sobre o chat quando o container
   *  do ChatPanel é estreito (sheet < 700px). Default: inline coluna fixa. */
  floating?: boolean;
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
  floating = false,
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
    <div
      className={cn(
        "flex flex-col bg-background border-l",
        floating
          ? // Overlay sobre o chat: absoluto à direita, full height do main.
            "absolute right-0 inset-y-0 z-20 w-[85%] max-w-[360px] shadow-2xl"
          : // Inline column: ocupa coluna fixa 360px ao lado do chat.
            "h-full w-[360px] shrink-0"
      )}
    >
      <div className="flex h-12 items-center justify-between gap-2 px-3 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <GitCommit className="h-4 w-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold">Mudanças</h3>
          {items.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] font-medium">
              {items.length}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="Fechar painel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {sessionId && (
        <div className="px-3 py-2 border-b">
          <div
            className="inline-flex w-full items-center rounded-full bg-muted p-0.5"
            role="tablist"
            aria-label="Filtrar mudanças"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!filterAll}
              onClick={() => setFilterAll(false)}
              className={cn(
                "flex-1 rounded-full px-3 h-6 text-[11px] font-medium transition-colors",
                !filterAll
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Esta sessão
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterAll}
              onClick={() => setFilterAll(true)}
              className={cn(
                "flex-1 rounded-full px-3 h-6 text-[11px] font-medium transition-colors",
                filterAll
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Todas
            </button>
          </div>
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

/**
 * Rótulo de autor da edição — MESMA semântica do ChangeLogPanel
 * (ver `changeLogAuthorLabel`): nome quando a entry tem userId; senão admite não
 * saber. "Você" saiu: o painel é visível a qualquer membro da org, e a entry
 * podia ser de outra pessoa.
 */
function authorBadge(item: ChangeLogItem): { label: string; className: string } {
  const manual = item.action === "human_doc_edit";
  const className = manual
    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
    : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300";
  switch (item.source) {
    case "ai":
      return {
        label: "IA",
        className:
          "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
      };
    case "user":
      return {
        label: item.userName || "Manual (autor não identificado)",
        className,
      };
    default:
      // "system" fica "Sistema" mesmo com userId — ali o usuário é o gatilho do
      // pipeline, não o autor da mudança.
      return { label: "Sistema", className: "bg-muted text-muted-foreground" };
  }
}

/** Rótulo PT-BR pra actions que aparecem crus. Só as user-facing importam; as
 *  demais (snake_case da IA) já existiam e ficam como estão. */
function actionLabel(action: string): string {
  if (action === "human_doc_edit") return "Edição manual";
  if (action === "settings_update") return "Configurações";
  return action;
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
  const author = authorBadge(item);
  // Expansível só quando há diff REAL: ambos snapshots não-nulos E diferentes.
  // Inclui inserção em doc vazio (htmlBefore="" ≠ conteúdo — o `!!` do servidor
  // excluiria); exclui no-op (antes==depois) e human_doc_edit (snapshots nulos).
  const hasDiff =
    item.htmlBefore !== null &&
    item.htmlAfter !== null &&
    item.htmlBefore !== item.htmlAfter;

  const header = (
    <>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            // max-w + truncate: rótulos longos ("Manual (autor não identificado)",
            // e-mails) não podem comer a linha inteira do item.
            "text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 max-w-[55%] truncate",
            author.className
          )}
          title={author.label}
        >
          {author.label}
        </span>
        <span className="text-xs font-medium truncate">{actionLabel(item.action)}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{time}</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
        {item.summary}
      </p>
    </>
  );

  return (
    <div className="rounded-md border bg-card">
      {hasDiff ? (
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
          <div className="flex-1 min-w-0">{header}</div>
        </button>
      ) : (
        <div className="flex w-full items-start gap-2 p-2.5">
          <div className="flex-1 min-w-0">{header}</div>
        </div>
      )}
      {hasDiff && expanded && item.htmlBefore !== null && item.htmlAfter !== null && (
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
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words leading-[1.5]">
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
