"use client";

/**
 * Aba "Notificações" do DealDetail — override por negócio do padrão da org
 * (matriz evento × canal), corretores extras (brokerIds), silêncio total e
 * histórico de envios externos (DealNotificationLog). Corretores do form
 * entram automaticamente; o picker cobre negócio sem form/comissão.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EventChannelMatrix,
  type MatrixValues,
} from "@/components/notifications/EventChannelMatrix";
import {
  DEAL_NOTIF_EVENT_LABEL,
  type DealNotifEvent,
} from "@/lib/notifications/deal-events-shared";
import { Mail, MessageCircle, X, RotateCcw, BellRing } from "lucide-react";

interface Broker {
  splitRecipientId: string;
  label: string;
  email: string | null;
  phone: string | null;
  notifyByEmail: boolean;
  notifyByWhatsapp: boolean;
}

interface LogRow {
  id: string;
  event: string;
  channel: string;
  recipientLabel: string | null;
  status: string;
  createdAt: string;
}

interface NotifState {
  overrides: {
    events?: Partial<Record<DealNotifEvent, unknown>>;
    brokerIds?: string[];
    muted?: boolean;
  };
  resolved: { events: MatrixValues; muted: boolean };
  brokers: Broker[];
  log: LogRow[];
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  sent: { text: "enviado", cls: "text-green-700 border-green-300 bg-green-50" },
  skipped: { text: "pulado", cls: "text-amber-800 border-amber-300 bg-amber-50" },
  failed: { text: "falhou", cls: "text-red-700 border-red-300 bg-red-50" },
};

export function NotificationsTab({ dealId }: { dealId: string }) {
  const [state, setState] = useState<NotifState | null>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<
    Array<{ id: string; label: string; email: string | null }>
  >([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}/notifications`, {
      credentials: "include",
    });
    if (!res.ok) {
      toast.error("Falha ao carregar notificações do negócio");
      return;
    }
    setState(await res.json());
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: unknown): Promise<boolean> {
    const res = await fetch(`/api/deals/${dealId}/notifications`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao salvar");
      return false;
    }
    await load();
    return true;
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(
        `/api/financeiro/split-recipients?kind=commissioner&q=${encodeURIComponent(q)}`,
        { credentials: "include" }
      );
      if (!res.ok) return;
      const data = await res.json();
      setOptions(
        (data.recipients ?? []).map(
          (r: { id: string; label: string; email: string | null }) => ({
            id: r.id,
            label: r.label,
            email: r.email,
          })
        )
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (!state) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  const muted = state.overrides.muted === true;
  const explicitIds = new Set(state.overrides.brokerIds ?? []);
  const overridden = new Set(
    Object.keys(state.overrides.events ?? {}) as DealNotifEvent[]
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BellRing className="h-4 w-4" /> Atualizações aos corretores
            </CardTitle>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Silenciar este negócio</span>
              <Switch
                checked={muted}
                onCheckedChange={(v) => void patch({ muted: v })}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Herda o padrão da imobiliária (Configurações → Notificações).
            Alterações aqui valem só pra este negócio.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <EventChannelMatrix
            values={state.resolved.events}
            disabled={muted}
            overriddenEvents={overridden}
            onToggle={(ev, channel, value) =>
              void patch({ events: { [ev]: { broker: { [channel]: value } } } })
            }
          />
          {overridden.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void patch({ clearEvents: [...overridden] })}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restaurar padrão da
              imobiliária
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Corretores deste negócio</CardTitle>
          <p className="text-sm text-muted-foreground">
            Corretores informados no formulário entram automaticamente. Adicione
            outros do cadastro se necessário.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.brokers.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Nenhum corretor vinculado ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {state.brokers.map((b) => (
                <div
                  key={b.splitRecipientId}
                  className="flex items-center justify-between gap-3 border rounded p-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{b.label}</div>
                    <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                      {b.email && <span>{b.email}</span>}
                      {b.phone && <span>{b.phone}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Mail
                      className={`h-4 w-4 ${b.notifyByEmail && b.email ? "text-green-600" : "text-muted-foreground/30"}`}
                    />
                    <MessageCircle
                      className={`h-4 w-4 ${b.notifyByWhatsapp && b.phone ? "text-green-600" : "text-muted-foreground/30"}`}
                    />
                    {explicitIds.has(b.splitRecipientId) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remover deste negócio"
                        onClick={() =>
                          void patch({
                            brokerIds: [...explicitIds].filter(
                              (id) => id !== b.splitRecipientId
                            ),
                          })
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <Input
              placeholder="Buscar corretor cadastrado pra adicionar..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {options.length > 0 && (
              <div className="absolute z-10 mt-1 w-full border rounded-md bg-popover shadow-md max-h-56 overflow-y-auto">
                {options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                    onClick={() => {
                      setQuery("");
                      setOptions([]);
                      void patch({ brokerIds: [...explicitIds, o.id] });
                    }}
                  >
                    <span className="font-medium">{o.label}</span>
                    {o.email && (
                      <span className="text-muted-foreground"> · {o.email}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Histórico de envios</CardTitle>
          <p className="text-sm text-muted-foreground">
            E-mails e WhatsApp enviados aos corretores. WhatsApp marcado como
            &quot;enviado&quot; = encaminhado ao assistente (sem confirmação de
            entrega).
          </p>
        </CardHeader>
        <CardContent>
          {state.log.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Nenhum envio ainda.
            </p>
          ) : (
            <div className="space-y-1.5">
              {state.log.map((row) => {
                const st = STATUS_LABEL[row.status] ?? STATUS_LABEL.sent;
                return (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 text-sm border-b last:border-b-0 py-1.5"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      {row.channel === "email" ? (
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate">
                        {DEAL_NOTIF_EVENT_LABEL[
                          row.event as DealNotifEvent
                        ] ?? row.event}
                        {row.recipientLabel ? ` → ${row.recipientLabel}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={`text-xs ${st.cls}`}>
                        {st.text}
                      </Badge>
                      <span
                        className="text-xs text-muted-foreground"
                        suppressHydrationWarning
                      >
                        {new Date(row.createdAt).toLocaleDateString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
