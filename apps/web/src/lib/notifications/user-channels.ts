/**
 * Canal externo (WhatsApp via Newton) das notificações do sistema para
 * USUÁRIOS da plataforma.
 *
 * O engate é a LINHA `Notification`, não o corpo de `emitNotification` — que
 * é `await`ada dentro de handlers de request em ~11 lugares e cujo contrato é
 * "insert puro que nunca rejeita". Um cron varre as linhas recentes cujo
 * `type` está na allowlist e despacha. Ganhos: zero latência no request path,
 * zero call-site tocado, tipo novo entra só quando listado no registry, e
 * `Notification.id` serve de dedupe universal (`batchId` é null em vários
 * tipos, então "insert criou ⇒ manda" não funcionaria).
 *
 * Mesmo padrão de reconciliação de queueSurveyDispatch + /api/cron/surveys/
 * dispatch. Idempotência por claim-first em UserNotificationDelivery: insert
 * "pending" → P2002 significa já despachado → settle sent/skipped/deferred.
 *
 * Fire-and-forget: NUNCA lança.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { triggerNewtonNotify } from "@/lib/newton/notify-trigger";
import { isWithinWhatsappWindow } from "@/lib/newton/whatsapp-window";
import {
  buildUserNotifyMessage,
  policyForType,
  USER_CHANNEL_TYPES,
} from "./user-channels-registry";
import { filterUsersOptedIn } from "./user-prefs";
import {
  resolveNotificationUsers,
  type NotificationRowLite,
  type UserRecipient,
} from "./user-recipients";

/** Quantos envios um mesmo usuário pode receber por hora. */
export const MAX_PER_USER_PER_HOUR = 6;

/** Janela do sweep. Notificação mais velha que isso não é despachada —
 *  ligar a feature não deve disparar backlog histórico. */
const DEFAULT_SINCE_MS = 30 * 60_000;
const DEFAULT_LIMIT = 200;

type DeliveryStatus = "sent" | "skipped" | "failed" | "deferred";

const NOTIFICATION_SELECT = {
  id: true,
  orgId: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  linkUrl: true,
  metadata: true,
} as const;

interface NotificationRow extends NotificationRowLite {
  title: string;
  body: string;
}

/**
 * Insert-first (chokepoint de idempotência). Retorna o id ou null quando a
 * linha já existia (P2002) — o chamador pula o envio. Nasce "pending" e é
 * assentada depois, pra que o histórico não afirme "enviado" se a function
 * morrer entre o claim e o `fetch`.
 */
async function claimDelivery(params: {
  orgId: string;
  userId: string;
  notificationId: string;
  type: string;
  category: string;
  dedupeKey: string;
}): Promise<string | null> {
  try {
    const row = await prisma.userNotificationDelivery.create({
      data: { ...params, channel: "whatsapp", status: "pending" },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return null;
    }
    throw err;
  }
}

async function settleDelivery(
  id: string,
  status: DeliveryStatus,
  detail?: Record<string, unknown>
): Promise<void> {
  await prisma.userNotificationDelivery
    .update({
      where: { id },
      data: {
        status,
        settledAt: new Date(),
        detail: detail ? (detail as Prisma.InputJsonValue) : undefined,
      },
    })
    .catch(() => undefined);
}

/** Já estourou o teto de mensagens desta hora? */
async function isRateCapped(userId: string): Promise<boolean> {
  try {
    const sent = await prisma.userNotificationDelivery.count({
      where: {
        userId,
        status: "sent",
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    return sent >= MAX_PER_USER_PER_HOUR;
  } catch {
    // Sem conseguir contar, não bloqueia — o cap é defesa contra rajada, e o
    // claim já garante que ninguém recebe a MESMA notificação duas vezes.
    return false;
  }
}

async function deliverToUser(params: {
  notification: NotificationRow;
  user: UserRecipient;
  category: string;
  orgName: string | null;
}): Promise<DeliveryStatus | "duplicate"> {
  const { notification, user, category, orgName } = params;

  const deliveryId = await claimDelivery({
    orgId: notification.orgId,
    userId: user.userId,
    notificationId: notification.id,
    type: notification.type,
    category,
    dedupeKey: `n:${notification.id}`,
  });
  if (!deliveryId) return "duplicate";

  if (await isRateCapped(user.userId)) {
    await settleDelivery(deliveryId, "skipped", { reason: "rate_cap" });
    return "skipped";
  }

  const outcome = await triggerNewtonNotify({
    orgId: notification.orgId,
    audience: "platform_user",
    phone: user.phone,
    recipientName: user.name ?? "",
    message: buildUserNotifyMessage(notification),
    orgName,
    linkUrl: notification.linkUrl,
  });

  if (outcome === "skipped") {
    await settleDelivery(deliveryId, "skipped", {
      reason: "newton_gate_off_ou_sidecar_ausente",
    });
    return "skipped";
  }

  await settleDelivery(deliveryId, "sent", { via: "newton_sidecar" });
  return "sent";
}

/**
 * Despacha UMA notificação. Nunca lança. `row` evita re-query quando o sweep
 * já carregou a linha.
 */
export async function dispatchUserNotification(params: {
  notificationId: string;
  row?: NotificationRow;
}): Promise<{ sent: number; skipped: number; deferred: number }> {
  const zero = { sent: 0, skipped: 0, deferred: 0 };
  try {
    const notification =
      params.row ??
      ((await prisma.notification.findUnique({
        where: { id: params.notificationId },
        select: NOTIFICATION_SELECT,
      })) as NotificationRow | null);
    if (!notification) return zero;

    const policy = policyForType(notification.type);
    if (!policy) return zero; // fora da allowlist — no-op silencioso

    const { users } = await resolveNotificationUsers(notification);
    if (users.length === 0) return zero;

    const allowed = await filterUsersOptedIn({
      userIds: users.map((u) => u.userId),
      orgId: notification.orgId,
      category: policy.category,
    });
    const targets = users.filter((u) => allowed.has(u.userId));
    if (targets.length === 0) return zero;

    // Fora da janela ninguém é notificado AGORA e nada é gravado: sem claim,
    // o sweep repega a mesma notificação quando a janela abrir.
    if (!isWithinWhatsappWindow()) {
      return { ...zero, deferred: targets.length };
    }

    const org = await prisma.organization
      .findUnique({
        where: { id: notification.orgId },
        select: { name: true },
      })
      .catch(() => null);

    const result = { ...zero };
    for (const user of targets) {
      const outcome = await deliverToUser({
        notification,
        user,
        category: policy.category,
        orgName: org?.name ?? null,
      });
      if (outcome === "sent") result.sent += 1;
      else if (outcome === "skipped") result.skipped += 1;
    }
    return result;
  } catch (err) {
    console.error(
      `[user-channels] dispatchUserNotification(${params.notificationId}) falhou:`,
      err instanceof Error ? err.message : String(err)
    );
    return zero;
  }
}

/**
 * Varre as notificações recentes da allowlist e despacha cada uma. Nunca
 * lança — uma notificação problemática não derruba o lote.
 */
export async function sweepUserNotifications(params?: {
  sinceMs?: number;
  limit?: number;
}): Promise<{ scanned: number; sent: number; skipped: number; deferred: number }> {
  const sinceMs = params?.sinceMs ?? DEFAULT_SINCE_MS;
  const limit = params?.limit ?? DEFAULT_LIMIT;
  const totals = { scanned: 0, sent: 0, skipped: 0, deferred: 0 };

  // Fora da janela nem varre — economiza a query inteira.
  if (!isWithinWhatsappWindow()) return totals;

  try {
    const rows = (await prisma.notification.findMany({
      where: {
        type: { in: USER_CHANNEL_TYPES },
        createdAt: { gte: new Date(Date.now() - sinceMs) },
      },
      select: NOTIFICATION_SELECT,
      orderBy: { createdAt: "asc" },
      take: limit,
    })) as NotificationRow[];

    totals.scanned = rows.length;
    for (const row of rows) {
      const r = await dispatchUserNotification({
        notificationId: row.id,
        row,
      });
      totals.sent += r.sent;
      totals.skipped += r.skipped;
      totals.deferred += r.deferred;
    }
  } catch (err) {
    console.error(
      "[user-channels] sweepUserNotifications falhou:",
      err instanceof Error ? err.message : String(err)
    );
  }
  return totals;
}
