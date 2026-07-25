/**
 * Constantes e tipos do canal externo de notificação ao USUÁRIO da plataforma
 * — client-safe (sem prisma), pra UI de preferências importar. Resolvers
 * server-side em user-prefs.ts; allowlist tipo→categoria em
 * user-channels-registry.ts.
 *
 * Espelha o par deal-events-shared.ts / deal-events-config.ts, mas com uma
 * diferença deliberada de política: aqui a ORG SÓ PODE DESLIGAR. O número é
 * PII pessoal do usuário, não cadastro comercial — o oposto do broker, onde a
 * org liga o canal e o SplitRecipient desliga.
 */

export const USER_NOTIF_CATEGORIES = [
  "deal_updates",
  "assinaturas",
  "certidoes",
  "financeiro",
  "propostas",
  "sistema",
] as const;

export type UserNotifCategory = (typeof USER_NOTIF_CATEGORIES)[number];

export const USER_NOTIF_CATEGORY_LABEL: Record<UserNotifCategory, string> = {
  deal_updates: "Andamento dos negócios",
  assinaturas: "Assinaturas",
  certidoes: "Certidões",
  financeiro: "Cobranças e repasses",
  propostas: "Propostas",
  sistema: "Avisos do sistema",
};

export const USER_NOTIF_CATEGORY_HINT: Record<UserNotifCategory, string> = {
  deal_updates:
    "Formulário concluído, mudança de status, contrato pronto ou enviado.",
  assinaturas: "Contrato assinado, recusado ou e-mail que não chegou.",
  certidoes: "Lote concluído, certidão travada ou faltando dado.",
  financeiro: "Cobrança gerada, paga, vencida e aprovações de repasse.",
  propostas: "Proposta aceita, recusada ou expirada.",
  sistema:
    "Falha na geração de contrato, orçamento de IA e respostas do suporte.",
};

export interface UserChannelToggles {
  whatsapp?: boolean;
}

/** Shape persistido em UserNotificationPreference.settingsJson. */
export interface UserNotificationPrefsJson {
  events?: Partial<Record<UserNotifCategory, UserChannelToggles>>;
  /**
   * Quando o canal foi ligado por um ADMIN e não pela própria pessoa (ver
   * `userRecipients` abaixo). Sem isto, o `whatsappOptInAt` diria "ela
   * consentiu" numa linha em que ela não fez nada — o campo mentiria.
   *
   * Ausência = opt-in próprio, o caminho normal do /perfil.
   */
  enabledBy?: Partial<
    Record<UserNotifCategory, { byUserId: string; at: string }>
  >;
}

/**
 * Shape do kill switch da org, dentro de
 * OrgNotificationSettings.settingsJson.userChannels. Só desliga: ausência de
 * chave = "não interfere", nunca "liga".
 */
export interface OrgUserChannelsJson {
  enabled?: boolean;
  events?: Partial<Record<UserNotifCategory, boolean>>;
}

/** Default de código: nada ligado. Coerente com DEFAULT_EVENT do broker. */
export const DEFAULT_USER_CHANNEL: Required<UserChannelToggles> = {
  whatsapp: false,
};

/**
 * Destinatários ESCOLHIDOS PELO ADMIN, dentro de
 * OrgNotificationSettings.settingsJson.userRecipients.
 *
 * Por que existe: a cascata de user-recipients.ts resolve no dono do negócio, e
 * há quem precise saber de tudo sem ser dono de nada — a negociadora que
 * acompanha o processo inteiro é o caso que motivou isto. Esta lista SOMA à
 * cascata, para qualquer negócio da org.
 *
 * Diferente do kill switch (`userChannels`), que só desliga, esta lista LIGA: o
 * admin escolhe e o canal é habilitado em nome da pessoa, com registro em
 * `UserNotificationPrefsJson.enabledBy`. A pessoa mantém o poder de desligar no
 * próprio perfil — "o admin liga, o usuário desliga", simétrico ao inverso.
 *
 * NÃO confundir com `NotificationConfigJson.brokerIds`, que são
 * `SplitRecipient.id` de corretores. `User.id` ali é no-op silencioso.
 */
export interface OrgUserRecipientsJson {
  /** userIds por categoria. */
  events?: Partial<Record<UserNotifCategory, string[]>>;
}

export function isUserNotifCategory(v: unknown): v is UserNotifCategory {
  return (
    typeof v === "string" &&
    (USER_NOTIF_CATEGORIES as readonly string[]).includes(v)
  );
}

/** Lê `settingsJson.userRecipients` tolerando lixo. Client-safe. */
export function coerceOrgUserRecipients(raw: unknown): OrgUserRecipientsJson {
  if (typeof raw !== "object" || raw === null) return {};
  const settings = raw as { userRecipients?: unknown };
  const ur = settings.userRecipients;
  if (typeof ur !== "object" || ur === null) return {};
  return ur as OrgUserRecipientsJson;
}

/** Os userIds escolhidos para uma categoria. Sempre array, sempre sem lixo. */
export function orgSelectedUserIds(
  settingsJson: unknown,
  category: UserNotifCategory
): string[] {
  const list = coerceOrgUserRecipients(settingsJson).events?.[category];
  if (!Array.isArray(list)) return [];
  return [
    ...new Set(
      list.filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
}
