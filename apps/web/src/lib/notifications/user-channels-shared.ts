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

export function isUserNotifCategory(v: unknown): v is UserNotifCategory {
  return (
    typeof v === "string" &&
    (USER_NOTIF_CATEGORIES as readonly string[]).includes(v)
  );
}
