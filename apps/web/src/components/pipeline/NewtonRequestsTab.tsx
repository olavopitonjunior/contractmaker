"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  Plus,
  Loader2,
  Users,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
} from "lucide-react";
import { toast } from "sonner";

interface TimelineEvent {
  at: string;
  actor: string;
  type: string;
  note?: string;
}

interface NewtonRequest {
  id: string;
  dealId: string;
  ask: string;
  targetType: "contact" | "group";
  targetRef: string | null;
  targetLabel: string | null;
  status: string;
  priority: string;
  cronJobIds: string[];
  lastNudgeAt: string | null;
  resolutionNote: string | null;
  events: TimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

const STATUS_META: Record<
  string,
  { label: string; className: string; icon: React.ReactNode }
> = {
  open: {
    label: "Aberto",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    icon: <Clock className="h-3 w-3" />,
  },
  chasing: {
    label: "Cobrando",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    icon: <Send className="h-3 w-3" />,
  },
  awaiting_reply: {
    label: "Aguardando resposta",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    icon: <Clock className="h-3 w-3" />,
  },
  fulfilled: {
    label: "Resolvido",
    className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  cancelled: {
    label: "Cancelado",
    className: "bg-slate-100 text-slate-500 line-through dark:bg-slate-800",
    icon: <XCircle className="h-3 w-3" />,
  },
};

const EVENT_LABEL: Record<string, string> = {
  created: "Pedido criado",
  chased: "Newton cobrou",
  awaiting_reply: "Aguardando resposta",
  reminder_scheduled: "Lembrete agendado",
  reply_received: "Resposta recebida",
  fulfilled: "Resolvido",
  cancelled: "Cancelado",
  note: "Nota",
};

function fmt(dt: string): string {
  return new Date(dt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NewtonRequestsTab({ dealId }: { dealId: string }) {
  const [requests, setRequests] = useState<NewtonRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // form state
  const [ask, setAsk] = useState("");
  const [targetType, setTargetType] = useState<"contact" | "group">("contact");
  const [targetRef, setTargetRef] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [priority, setPriority] = useState<"normal" | "high">("normal");

  // Grupo do negócio (auto-match): vínculo atual + candidatos pra escolher.
  const [groupInfo, setGroupInfo] = useState<{
    linkedGroupId: string | null;
    candidates: { groupId: string; name: string | null; hits: number }[];
  } | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/newton-requests`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      toast.error("Falha ao carregar pedidos ao Newton");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  const loadGroupInfo = useCallback(async () => {
    setGroupLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/group-candidates`);
      if (res.ok) setGroupInfo(await res.json());
    } catch {
      /* silencioso */
    } finally {
      setGroupLoading(false);
    }
  }, [dealId]);

  async function pickGroup(groupId: string, name: string | null) {
    try {
      const res = await fetch(`/api/newton/deal-group-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, groupId, groupLabel: name ?? undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Grupo vinculado ao negócio");
      setGroupInfo({ linkedGroupId: groupId, candidates: [] });
    } catch {
      toast.error("Falha ao vincular o grupo");
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  // Ao abrir o modal e escolher "grupo", busca o vínculo/candidatos.
  useEffect(() => {
    if (dialogOpen && targetType === "group" && !groupInfo) loadGroupInfo();
  }, [dialogOpen, targetType, groupInfo, loadGroupInfo]);

  function resetForm() {
    setAsk("");
    setTargetType("contact");
    setTargetRef("");
    setTargetLabel("");
    setPriority("normal");
  }

  async function handleCreate() {
    if (ask.trim().length < 3) {
      toast.error("Descreva o que falta (mín. 3 caracteres)");
      return;
    }
    if (targetType === "contact" && !targetRef.trim()) {
      toast.error("Informe o telefone do contato");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/newton-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ask: ask.trim(),
          targetType,
          targetRef: targetRef.trim() || undefined,
          targetLabel: targetLabel.trim() || undefined,
          priority,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? String(res.status));
      }
      toast.success("Pedido enviado ao Newton — ele vai cobrar a informação");
      resetForm();
      setDialogOpen(false);
      load();
    } catch (err) {
      toast.error(`Falha ao criar pedido: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      const res = await fetch(`/api/deals/${dealId}/newton-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Pedido cancelado");
      load();
    } catch {
      toast.error("Falha ao cancelar");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bot className="h-4 w-4" />
          <span>
            Peça ao Newton para conseguir uma informação que falta — ele cobra o
            contato ou o grupo do negócio por você.
          </span>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Novo pedido ao Newton
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo pedido ao Newton</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="ask">O que falta?</Label>
                <Textarea
                  id="ask"
                  placeholder="Ex: matrícula atualizada do imóvel (emitida nos últimos 30 dias)"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Cobrar de</Label>
                <Select
                  value={targetType}
                  onValueChange={(v) => setTargetType(v as "contact" | "group")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contact">
                      <span className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5" /> Um contato (telefone)
                      </span>
                    </SelectItem>
                    <SelectItem value="group">
                      <span className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5" /> O grupo do negócio
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {targetType === "contact" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ref">Telefone (com DDD)</Label>
                  <Input
                    id="ref"
                    placeholder="5511987654321"
                    value={targetRef}
                    onChange={(e) => setTargetRef(e.target.value)}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Grupo do negócio</Label>
                  {groupLoading ? (
                    <p className="text-xs text-muted-foreground">Procurando grupos…</p>
                  ) : groupInfo?.linkedGroupId ? (
                    <p className="text-xs text-green-700 dark:text-green-400">
                      Grupo vinculado ✓ — Newton vai cobrar nele.
                    </p>
                  ) : groupInfo && groupInfo.candidates.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Escolha o grupo deste negócio:
                      </p>
                      {groupInfo.candidates.map((c) => (
                        <button
                          key={c.groupId}
                          type="button"
                          onClick={() => pickGroup(c.groupId, c.name)}
                          className="block w-full text-left text-sm rounded-md border px-2 py-1.5 hover:bg-muted"
                        >
                          {c.name ?? c.groupId}
                          <span className="text-xs text-muted-foreground">
                            {" "}· {c.hits} parte(s) no grupo
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sem grupo identificado ainda. O Newton confirma com você qual é o
                      grupo quando for cobrar.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="label">Quem é (opcional)</Label>
                <Input
                  id="label"
                  placeholder="Ex: vendedor Yamamoto"
                  value={targetLabel}
                  onChange={(e) => setTargetLabel(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Prioridade</Label>
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as "normal" | "high")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Enviar ao Newton
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum pedido ao Newton ainda. Crie um quando faltar alguma informação
            para o contrato.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.open;
            const terminal = r.status === "fulfilled" || r.status === "cancelled";
            return (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base font-medium leading-snug">
                      {r.ask}
                    </CardTitle>
                    <Badge
                      className={`shrink-0 gap-1 ${meta.className}`}
                      variant="secondary"
                    >
                      {meta.icon}
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {r.targetType === "group" ? (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> Grupo do negócio
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {r.targetLabel ?? r.targetRef ?? "Contato"}
                      </span>
                    )}
                    {r.priority === "high" && (
                      <Badge variant="outline" className="text-[10px] py-0">
                        Alta
                      </Badge>
                    )}
                    <span>· criado {fmt(r.createdAt)}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {r.resolutionNote && (
                    <p className="text-sm rounded-md bg-green-50 dark:bg-green-950/20 px-3 py-2 text-green-800 dark:text-green-300">
                      {r.resolutionNote}
                    </p>
                  )}
                  {r.events.length > 0 && (
                    <ol className="space-y-1.5 border-l pl-3">
                      {r.events.map((ev, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {EVENT_LABEL[ev.type] ?? ev.type}
                          </span>
                          <span> · {fmt(ev.at)}</span>
                          {ev.note && <span className="block italic">{ev.note}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {!terminal && (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleCancel(r.id)}
                      >
                        Cancelar pedido
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
