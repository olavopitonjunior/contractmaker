/**
 * NewtonRequest — helpers compartilhados entre os endpoints REST (sessão da
 * negociadora) e os endpoints Bearer que o Newton consome.
 *
 * Um NewtonRequest é um "pedido ao Newton" ancorado num Deal: a negociadora
 * registra o que falta e para quem cobrar; Newton vai até o grupo/contato,
 * cobra, agenda lembretes e fecha quando a info chega.
 */
import { Prisma } from "@prisma/client";
import type { NewtonRequest } from "@prisma/client";

export type NewtonRequestStatus =
  | "open"
  | "chasing"
  | "awaiting_reply"
  | "fulfilled"
  | "cancelled";

export type NewtonRequestTargetType = "contact" | "group";

/** Ator de um evento da timeline. */
export type TimelineActor = "negociadora" | "newton" | "contato" | "sistema";

export interface TimelineEvent {
  at: string; // ISO8601
  actor: TimelineActor;
  type: string; // "created" | "chased" | "reminder_scheduled" | "reply_received" | "fulfilled" | "cancelled" | "note"
  note?: string;
}

/**
 * Anexa um evento à timeline (append-only). `eventsJson` no Prisma é `Json?`;
 * tratamos como array de TimelineEvent, tolerando null/legado. Retorna um valor
 * pronto para gravar em campo `Json` do Prisma (omite `note` undefined — JSON
 * não aceita undefined).
 */
export function appendEvent(
  existing: unknown,
  event: Omit<TimelineEvent, "at"> & { at?: string }
): Prisma.InputJsonValue {
  const prior = Array.isArray(existing) ? (existing as TimelineEvent[]) : [];
  const next: TimelineEvent = {
    at: event.at ?? new Date().toISOString(),
    actor: event.actor,
    type: event.type,
    ...(event.note ? { note: event.note } : {}),
  };
  return [...prior, next] as unknown as Prisma.InputJsonValue;
}

/** Shape serializável pra UI / Newton (sem vazar relations). */
export function serializeRequest(r: NewtonRequest) {
  return {
    id: r.id,
    dealId: r.dealId,
    ask: r.ask,
    targetType: r.targetType,
    targetRef: r.targetRef,
    targetLabel: r.targetLabel,
    status: r.status,
    priority: r.priority,
    dueAt: r.dueAt?.toISOString() ?? null,
    cronJobIds: r.cronJobIds,
    lastNudgeAt: r.lastNudgeAt?.toISOString() ?? null,
    resolutionNote: r.resolutionNote,
    events: Array.isArray(r.eventsJson) ? r.eventsJson : [],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
