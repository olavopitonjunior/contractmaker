"use client";

/**
 * Matriz evento × canal — compartilhada entre /settings/notificacoes (padrão da
 * org) e a aba Notificações do deal (override). O container decide o que fazer
 * no onToggle.
 *
 * `audience` escolhe a coluna de dados: "broker" (corretores, todos os
 * eventos), "party" (partes do negócio, só os eventos da allowlist — daí o
 * `events`) ou "manager" (gerente atribuído, todos os eventos).
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
  {
    broker: { email: boolean; whatsapp: boolean };
    party: { email: boolean; whatsapp: boolean };
    /** Opcional: resposta de API anterior à v3 não traz o público gerente. */
    manager?: { email: boolean; whatsapp: boolean };
  }
>;

const CELL_OFF = { email: false, whatsapp: false } as const;

export function EventChannelMatrix({
  values,
  onToggle,
  disabled,
  overriddenEvents,
  audience = "broker",
  events,
  whatsappDisabledReason,
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
  audience?: "broker" | "party" | "manager";
  /** Subconjunto de eventos a exibir. Default: todos. */
  events?: readonly DealNotifEvent[];
  /**
   * Quando presente, a coluna WhatsApp fica desabilitada e explicada. Sem esse
   * texto o admin ligaria o canal e nada aconteceria — o envio viraria
   * `skipped` num log que ele não abre.
   */
  whatsappDisabledReason?: string | null;
}) {
  const rows = events ?? DEAL_NOTIF_EVENTS;
  const whatsappBlocked = Boolean(whatsappDisabledReason);
  return (
    <div className="space-y-2">
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
        {rows.map((ev) => {
          // `manager` é opcional no tipo (resposta pré-v3); sem contato o
          // toggle simplesmente nasce desligado em vez de estourar.
          const cell = values[ev]?.[audience] ?? CELL_OFF;
          return (
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
                checked={cell.email}
                disabled={disabled}
                onCheckedChange={(v) => onToggle(ev, "email", v)}
              />
            </span>
            <span
              className="w-16 flex justify-center"
              title={whatsappDisabledReason ?? undefined}
            >
              <Switch
                checked={cell.whatsapp && !whatsappBlocked}
                disabled={disabled || whatsappBlocked}
                onCheckedChange={(v) => onToggle(ev, "whatsapp", v)}
              />
            </span>
          </div>
          );
        })}
      </div>
      {whatsappDisabledReason && (
        <p className="text-xs text-amber-600">{whatsappDisabledReason}</p>
      )}
    </div>
  );
}
