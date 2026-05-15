"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, MoreVertical, Pencil, Archive, Trash2, MessageSquare, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface ChatSessionItem {
  id: string;
  title: string | null;
  updatedAt: string;
  msgCount: number;
}

interface ChatSessionSidebarProps {
  contractId: string;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: (sessionId: string) => void;
  /** Reload trigger — incrementa quando uma session é criada/renomeada/etc
   *  e queremos re-buscar a lista. */
  reloadKey?: number;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return "agora";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}min`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString("pt-BR");
}

type SessionGroup = "hoje" | "ontem" | "semana" | "antigas";

/**
 * Agrupa sessions por janela temporal (Lovable-style). Compara `updatedAt`
 * com hoje 00:00 local. "semana" = 2-7 dias atras. "antigas" = >7 dias.
 */
function groupSessionsByDate(
  sessions: ChatSessionItem[]
): Array<{ key: SessionGroup; label: string; items: ChatSessionItem[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: Record<SessionGroup, ChatSessionItem[]> = {
    hoje: [],
    ontem: [],
    semana: [],
    antigas: [],
  };

  for (const s of sessions) {
    const t = new Date(s.updatedAt).getTime();
    if (t >= startOfToday.getTime()) groups.hoje.push(s);
    else if (t >= startOfYesterday.getTime()) groups.ontem.push(s);
    else if (t >= sevenDaysAgo.getTime()) groups.semana.push(s);
    else groups.antigas.push(s);
  }

  return (
    [
      { key: "hoje" as const, label: "Hoje", items: groups.hoje },
      { key: "ontem" as const, label: "Ontem", items: groups.ontem },
      { key: "semana" as const, label: "Esta semana", items: groups.semana },
      { key: "antigas" as const, label: "Mais antigas", items: groups.antigas },
    ]
  ).filter((g) => g.items.length > 0);
}

export function ChatSessionSidebar({
  contractId,
  activeSessionId,
  onSelect,
  onCreate,
  reloadKey,
}: ChatSessionSidebarProps) {
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ChatSessionItem | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/chat-sessions`);
      if (res.ok) {
        const data = (await res.json()) as ChatSessionItem[];
        setSessions(data);
      }
    } catch {
      toast.error("Não foi possível carregar sessões");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId, reloadKey]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/chat-sessions`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("create_failed");
      const created = (await res.json()) as ChatSessionItem;
      setSessions((prev) => [created, ...prev]);
      onCreate(created.id);
    } catch {
      toast.error("Não foi possível criar sessão");
    } finally {
      setCreating(false);
    }
  }

  async function handleRename() {
    if (!renaming || !renameValue.trim()) return;
    const session = renaming;
    setRenaming(null);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/chat-sessions/${session.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: renameValue.trim() }),
        }
      );
      if (!res.ok) throw new Error("rename_failed");
      setSessions((prev) =>
        prev.map((s) =>
          s.id === session.id ? { ...s, title: renameValue.trim() } : s
        )
      );
      toast.success("Sessão renomeada");
    } catch {
      toast.error("Não foi possível renomear");
    }
  }

  async function handleArchive(session: ChatSessionItem) {
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/chat-sessions/${session.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: true }),
        }
      );
      if (!res.ok) throw new Error("archive_failed");
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      toast.success("Sessão arquivada");
    } catch {
      toast.error("Não foi possível arquivar");
    }
  }

  async function handleDelete(session: ChatSessionItem) {
    if (!confirm(`Apagar sessão "${session.title || "sem título"}"? Mensagens serão perdidas.`)) {
      return;
    }
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/chat-sessions/${session.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("delete_failed");
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      toast.success("Sessão apagada");
    } catch {
      toast.error("Não foi possível apagar");
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-muted/30 border-r">
      <div className="p-2 border-b">
        <Button
          variant="default"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Nova sessão
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8 px-3 leading-relaxed">
            Nenhuma sessão ainda. Clique em <strong>+ Nova sessão</strong> ou comece
            digitando à direita.
          </p>
        ) : (
          groupSessionsByDate(sessions).map((group) => (
            <div key={group.key} className="mb-3 last:mb-0">
              <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-semibold px-2 py-1 mb-0.5">
                {group.label}
              </h4>
              <div className="space-y-0.5">
                {group.items.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "group relative rounded-md px-2 py-2 cursor-pointer text-sm hover:bg-accent transition-colors",
                      s.id === activeSessionId && "bg-accent"
                    )}
                    onClick={() => onSelect(s.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1 text-xs leading-tight font-medium">
                        {s.title || "Sem título"}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 hover:bg-background rounded shrink-0 transition-opacity"
                            aria-label="Mais opções"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameValue(s.title || "");
                              setRenaming(s);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Renomear
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleArchive(s)}>
                            <Archive className="h-3.5 w-3.5 mr-2" />
                            Arquivar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(s)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Apagar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 pl-5 text-[10px] text-muted-foreground">
                      <span>{relativeTime(s.updatedAt)}</span>
                      <span>·</span>
                      <span>{s.msgCount} msg{s.msgCount === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear sessão</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Novo título"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenaming(null)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleRename}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
