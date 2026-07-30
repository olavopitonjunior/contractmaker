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
  /** v2: partes do negócio (comprador/vendedor, locador/locatário). */
  party?: ChannelToggles;
}

/**
 * Eventos que PODEM alcançar as partes. Allowlist deliberadamente curta: o
 * cliente final só recebe marcos que ele entende sem contexto interno —
 * contrato assinado e cobrança emitida. "Contrato pronto", "mudança de status"
 * e afins são vocabulário da esteira, não do cliente.
 *
 * É defesa, não só documentação: o resolver ZERA `party` de qualquer evento
 * fora desta lista, então config antiga (ou escrita à mão no JSON) nunca
 * ressuscita um envio que o produto não aprovou.
 */
export const PARTY_CAPABLE_EVENTS = [
  "contract_signed",
  "charge_created",
] as const satisfies readonly DealNotifEvent[];

export type PartyCapableEvent = (typeof PARTY_CAPABLE_EVENTS)[number];

export function isPartyCapableEvent(
  event: DealNotifEvent
): event is PartyCapableEvent {
  return (PARTY_CAPABLE_EVENTS as readonly string[]).includes(event);
}

/** Shape persistido (org settingsJson e deal notificationsJson). */
export interface NotificationConfigJson {
  events?: Partial<Record<DealNotifEvent, EventAudienceToggles>>;
  /** Só org: régua do lembrete de preenchimento. */
  formReminder?: { enabled?: boolean; days?: number[] };
  /** Só deal: corretores explícitos além dos comissionados do form. */
  brokerIds?: string[];
  /** Só deal: silencia os envios EXTERNOS (email/WhatsApp aos corretores)
   *  deste deal. O sino interno (usuários da plataforma) não é afetado —
   *  form_completed etc. já existiam antes da feature e são do time. */
  muted?: boolean;
}

export interface ResolvedEventConfig {
  broker: { email: boolean; whatsapp: boolean };
  party: { email: boolean; whatsapp: boolean };
}

export interface ResolvedNotificationConfig {
  events: Record<DealNotifEvent, ResolvedEventConfig>;
  formReminder: { enabled: boolean; days: number[] };
  brokerIds: string[];
  muted: boolean;
}

/**
 * Defaults de código. Corretor: email ligado, WhatsApp desligado (opt-in).
 * Parte: TUDO desligado — escrever pro cliente final da imobiliária é decisão
 * dela, evento a evento, nunca um default que liga sozinho numa migração.
 */
export const DEFAULT_EVENT: ResolvedEventConfig = {
  broker: { email: true, whatsapp: false },
  party: { email: false, whatsapp: false },
};

/** Party zerado — usado pra silenciar eventos fora da allowlist. */
export const PARTY_OFF = { email: false, whatsapp: false } as const;

export const DEFAULT_FORM_REMINDER = { enabled: true, days: [2, 5] };
