/**
 * Resolução da preferência efetiva de canal externo por usuário.
 *
 * Duas camadas, ASSIMÉTRICAS de propósito:
 *   1. usuário  — única que LIGA (opt-in explícito + consentimento datado)
 *   2. org      — só DESLIGA (kill switch global ou por categoria)
 *
 * Nunca lança: erro de DB → ninguém recebe (fail-closed). É o inverso do
 * deal-events-config.ts, que cai nos defaults em erro — lá o default é enviar
 * e-mail (inofensivo); aqui seria mandar WhatsApp sem consentimento provado.
 */

import { prisma } from "@/lib/db/prisma";
import {
  type OrgUserChannelsJson,
  type UserNotifCategory,
  type UserNotificationPrefsJson,
} from "./user-channels-shared";

function coerceUserPrefs(raw: unknown): UserNotificationPrefsJson {
  if (typeof raw !== "object" || raw === null) return {};
  return raw as UserNotificationPrefsJson;
}

function coerceOrgUserChannels(raw: unknown): OrgUserChannelsJson {
  if (typeof raw !== "object" || raw === null) return {};
  const settings = raw as { userChannels?: unknown };
  if (typeof settings.userChannels !== "object" || settings.userChannels === null) {
    return {};
  }
  return settings.userChannels as OrgUserChannelsJson;
}

/** A org bloqueou o canal (globalmente ou nesta categoria)? */
export async function isOrgUserChannelBlocked(
  orgId: string,
  category: UserNotifCategory
): Promise<boolean> {
  try {
    const row = await prisma.orgNotificationSettings.findUnique({
      where: { orgId },
      select: { settingsJson: true },
    });
    const cfg = coerceOrgUserChannels(row?.settingsJson);
    if (cfg.enabled === false) return true;
    return cfg.events?.[category] === false;
  } catch (err) {
    console.error("[user-prefs] falha ao ler kill switch da org:", err);
    // Fail-closed: sem conseguir confirmar que a org permite, não envia.
    return true;
  }
}

/**
 * Quais dos `userIds` aceitam WhatsApp nesta categoria, nesta org. Batch —
 * uma query pro lote, não uma por usuário. Retorna um Set pra o chamador
 * filtrar sem custo.
 */
export async function filterUsersOptedIn(params: {
  userIds: string[];
  orgId: string;
  category: UserNotifCategory;
}): Promise<Set<string>> {
  const { userIds, orgId, category } = params;
  if (userIds.length === 0) return new Set();

  try {
    if (await isOrgUserChannelBlocked(orgId, category)) return new Set();

    const rows = await prisma.userNotificationPreference.findMany({
      where: { orgId, userId: { in: userIds } },
      select: { userId: true, settingsJson: true, whatsappOptInAt: true },
    });

    const allowed = new Set<string>();
    for (const row of rows) {
      // Consentimento datado é obrigatório: um toggle ligado sem ele (bug,
      // backfill, migração futura) NÃO autoriza envio.
      if (!row.whatsappOptInAt) continue;
      const prefs = coerceUserPrefs(row.settingsJson);
      if (prefs.events?.[category]?.whatsapp === true) allowed.add(row.userId);
    }
    return allowed;
  } catch (err) {
    console.error("[user-prefs] falha ao resolver preferências:", err);
    return new Set();
  }
}
