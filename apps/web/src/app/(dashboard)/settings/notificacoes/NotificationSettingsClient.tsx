"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  EventChannelMatrix,
  type MatrixValues,
} from "@/components/notifications/EventChannelMatrix";
import type { DealNotifEvent } from "@/lib/notifications/deal-events-shared";

interface ResolvedConfig {
  events: MatrixValues;
  formReminder: { enabled: boolean; days: number[] };
}

export default function NotificationSettingsClient() {
  const [resolved, setResolved] = useState<ResolvedConfig | null>(null);
  const [daysText, setDaysText] = useState("");
  const [savingDays, setSavingDays] = useState(false);

  async function load() {
    const res = await fetch("/api/org/notification-settings", {
      credentials: "include",
    });
    if (!res.ok) {
      toast.error("Falha ao carregar configurações de notificação");
      return;
    }
    const data = await res.json();
    setResolved(data.resolved);
    setDaysText((data.resolved?.formReminder?.days ?? []).join(", "));
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(body: unknown): Promise<boolean> {
    const res = await fetch("/api/org/notification-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Falha ao salvar");
      return false;
    }
    setResolved(data.resolved);
    return true;
  }

  async function toggleEvent(
    ev: DealNotifEvent,
    channel: "email" | "whatsapp",
    value: boolean
  ) {
    if (!resolved) return;
    // Optimistic
    setResolved({
      ...resolved,
      events: {
        ...resolved.events,
        [ev]: { broker: { ...resolved.events[ev].broker, [channel]: value } },
      },
    });
    const ok = await patch({ events: { [ev]: { broker: { [channel]: value } } } });
    if (!ok) void load();
  }

  async function saveReminderDays() {
    const days = daysText
      .split(/[,;\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
    if (days.length === 0) {
      toast.error("Informe ao menos um dia entre 1 e 60 (ex.: 2, 5)");
      return;
    }
    setSavingDays(true);
    try {
      const ok = await patch({ formReminder: { days } });
      if (ok) toast.success("Régua do lembrete atualizada");
    } finally {
      setSavingDays(false);
    }
  }

  if (!resolved) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Eventos enviados aos corretores
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            E-mail sai com a marca da imobiliária; WhatsApp depende do
            assistente (Newton) estar habilitado e do corretor ter aceitado o
            canal no cadastro.
          </p>
        </CardHeader>
        <CardContent>
          <EventChannelMatrix values={resolved.events} onToggle={toggleEvent} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lembrete de preenchimento</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cobrança automática quando o formulário fica aberto sem conclusão.
            Os corretores do negócio recebem o lembrete com o link do
            formulário nos dias configurados após a criação.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Lembrete automático ativo</span>
            <Switch
              checked={resolved.formReminder.enabled}
              onCheckedChange={(v) => void patch({ formReminder: { enabled: v } })}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-sm block mb-1" htmlFor="reminder-days">
                Dias após a criação (separados por vírgula)
              </label>
              <Input
                id="reminder-days"
                placeholder="2, 5"
                value={daysText}
                onChange={(e) => setDaysText(e.target.value)}
                disabled={!resolved.formReminder.enabled}
              />
            </div>
            <Button
              onClick={saveReminderDays}
              disabled={savingDays || !resolved.formReminder.enabled}
            >
              {savingDays ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
