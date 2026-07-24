"use client";

/**
 * Matriz evento × canal (público "Corretores" na v1) — compartilhada entre
 * /settings/notificacoes (padrão da org) e a aba Notificações do deal
 * (override). O container decide o que fazer no onToggle.
 */

import { Switch } from "@/components/ui/switch";
import { Mail, MessageCircle } from "lucide-react";
import {
  DEAL_NOTIF_EVENTS,
  DEAL_NOTIF_EVENT_LABEL,
  type DealNotifEvent,
} from "@/lib/notifications/deal-events-shared";

/** Mesmo shape de ResolvedNotificationConfig.events (API GET). */
export type MatrixValues = Record<
  DealNotifEvent,
  { broker: { email: boolean; whatsapp: boolean } }
>;

export function EventChannelMatrix({
  values,
  onToggle,
  disabled,
  overriddenEvents,
}: {
  values: MatrixValues;
  onToggle: (
    event: DealNotifEvent,
    channel: "email" | "whatsapp",
    value: boolean
  ) => void;
  disabled?: boolean;
  /** Eventos com override local (deal) — ganham marcador visual. */
  overriddenEvents?: Set<DealNotifEvent>;
}) {
  return (
    <div className="border rounded-md divide-y">
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase">
        <span>Evento</span>
        <span className="flex items-center gap-1 w-16 justify-center">
          <Mail className="h-3.5 w-3.5" /> Email
        </span>
        <span className="flex items-center gap-1 w-16 justify-center">
          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
        </span>
      </div>
      {DEAL_NOTIF_EVENTS.map((ev) => (
        <div
          key={ev}
          className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5 items-center"
        >
          <span className="text-sm flex items-center gap-2">
            {DEAL_NOTIF_EVENT_LABEL[ev]}
            {overriddenEvents?.has(ev) && (
              <span
                className="text-[10px] uppercase font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded px-1"
                title="Este negócio sobrescreve o padrão da imobiliária"
              >
                override
              </span>
            )}
          </span>
          <span className="w-16 flex justify-center">
            <Switch
              checked={values[ev].broker.email}
              disabled={disabled}
              onCheckedChange={(v) => onToggle(ev, "email", v)}
            />
          </span>
          <span className="w-16 flex justify-center">
            <Switch
              checked={values[ev].broker.whatsapp}
              disabled={disabled}
              onCheckedChange={(v) => onToggle(ev, "whatsapp", v)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
