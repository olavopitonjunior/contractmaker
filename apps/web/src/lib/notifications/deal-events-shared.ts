/**
 * Constantes e tipos das notificações do processo — client-safe (sem prisma).
 * Resolvers server-side em deal-events-config.ts.
 */

export const DEAL_NOTIF_EVENTS = [
  "stage_change",
  "form_completed",
  "form_reminder",
  "contract_ready",
  "contract_sent",
  "contract_signed",
  "charge_created",
  "charge_paid",
] as const;

export type DealNotifEvent = (typeof DEAL_NOTIF_EVENTS)[number];

export const DEAL_NOTIF_EVENT_LABEL: Record<DealNotifEvent, string> = {
  stage_change: "Mudança de status",
  form_completed: "Formulário concluído",
  form_reminder: "Lembrete de preenchimento",
  contract_ready: "Contrato pronto",
  contract_sent: "Contrato enviado para assinatura",
  contract_signed: "Contrato assinado",
  charge_created: "Cobrança gerada",
  charge_paid: "Cobrança paga",
};

export interface ChannelToggles {
  email?: boolean;
  whatsapp?: boolean;
}

export interface EventAudienceToggles {
  broker?: ChannelToggles;
  // v2: party?: ChannelToggles;
}

/** Shape persistido (org settingsJson e deal notificationsJson). */
export interface NotificationConfigJson {
  events?: Partial<Record<DealNotifEvent, EventAudienceToggles>>;
  /** Só org: régua do lembrete de preenchimento. */
  formReminder?: { enabled?: boolean; days?: number[] };
  /** Só deal: corretores explícitos além dos comissionados do form. */
  brokerIds?: string[];
  /** Só deal: silencia todos os eventos deste deal. */
  muted?: boolean;
}

export interface ResolvedEventConfig {
  broker: { email: boolean; whatsapp: boolean };
}

export interface ResolvedNotificationConfig {
  events: Record<DealNotifEvent, ResolvedEventConfig>;
  formReminder: { enabled: boolean; days: number[] };
  brokerIds: string[];
  muted: boolean;
}

/** Defaults de código: email ligado, WhatsApp desligado (opt-in). */
export const DEFAULT_EVENT: ResolvedEventConfig = {
  broker: { email: true, whatsapp: false },
};

export const DEFAULT_FORM_REMINDER = { enabled: true, days: [2, 5] };
