/**
 * Config das notificações do processo (evento × público × canal) em 3 camadas:
 * defaults de código ← OrgNotificationSettings.settingsJson ← Deal.
 * notificationsJson. Chave ausente = herda da camada de baixo.
 *
 * v1: público "broker" (corretores). O shape já comporta "party" (partes) na
 * v2 sem migração — só nova chave. Constantes/tipos client-safe em
 * deal-events-shared.ts (este módulo importa prisma — só server).
 */

import { prisma } from "@/lib/db/prisma";
import {
  DEAL_NOTIF_EVENTS,
  DEFAULT_EVENT,
  DEFAULT_FORM_REMINDER,
  PARTY_OFF,
  isPartyCapableEvent,
  type DealNotifEvent,
  type EventAudienceToggles,
  type NotificationConfigJson,
  type ResolvedEventConfig,
  type ResolvedNotificationConfig,
} from "./deal-events-shared";

export {
  DEAL_NOTIF_EVENTS,
  DEAL_NOTIF_EVENT_LABEL,
  DEFAULT_FORM_REMINDER,
  PARTY_CAPABLE_EVENTS,
  isPartyCapableEvent,
} from "./deal-events-shared";
export type {
  DealNotifEvent,
  NotificationConfigJson,
  ResolvedNotificationConfig,
} from "./deal-events-shared";

function coerceConfig(raw: unknown): NotificationConfigJson {
  if (typeof raw !== "object" || raw === null) return {};
  return raw as NotificationConfigJson;
}

function mergeEvent(
  base: ResolvedEventConfig,
  patch: EventAudienceToggles | undefined
): ResolvedEventConfig {
  if (!patch) return base;
  return {
    broker: {
      email: patch.broker?.email ?? base.broker.email,
      whatsapp: patch.broker?.whatsapp ?? base.broker.whatsapp,
    },
    party: {
      email: patch.party?.email ?? base.party.email,
      whatsapp: patch.party?.whatsapp ?? base.party.whatsapp,
    },
  };
}

/**
 * Resolve a config efetiva: defaults ← org ← deal. Nunca lança (erro de DB →
 * defaults). Passar `dealNotificationsJson` já carregado evita re-query.
 */
export async function resolveEffectiveNotificationConfig(
  orgId: string,
  dealNotificationsJson?: unknown
): Promise<ResolvedNotificationConfig> {
  let orgJson: NotificationConfigJson = {};
  try {
    const row = await prisma.orgNotificationSettings.findUnique({
      where: { orgId },
      select: { settingsJson: true },
    });
    orgJson = coerceConfig(row?.settingsJson);
  } catch (err) {
    console.error("[deal-events-config] falha ao ler org settings:", err);
  }
  const dealJson = coerceConfig(dealNotificationsJson);

  const events = {} as Record<DealNotifEvent, ResolvedEventConfig>;
  for (const ev of DEAL_NOTIF_EVENTS) {
    const withOrg = mergeEvent(DEFAULT_EVENT, orgJson.events?.[ev]);
    const resolved = mergeEvent(withOrg, dealJson.events?.[ev]);
    // Allowlist de party é a última palavra: config antiga (ou JSON escrito à
    // mão) não liga o cliente final num evento que o produto não aprovou.
    events[ev] = isPartyCapableEvent(ev)
      ? resolved
      : { ...resolved, party: { ...PARTY_OFF } };
  }

  return {
    events,
    formReminder: {
      enabled: orgJson.formReminder?.enabled ?? DEFAULT_FORM_REMINDER.enabled,
      days:
        Array.isArray(orgJson.formReminder?.days) &&
        orgJson.formReminder!.days!.length > 0
          ? orgJson.formReminder!.days!.filter(
              (d) => Number.isInteger(d) && d > 0 && d <= 60
            )
          : DEFAULT_FORM_REMINDER.days,
    },
    brokerIds: Array.isArray(dealJson.brokerIds)
      ? dealJson.brokerIds.filter((id): id is string => typeof id === "string")
      : [],
    muted: dealJson.muted === true,
  };
}
