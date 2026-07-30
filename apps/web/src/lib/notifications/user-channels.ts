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
 * ── Estados e retomada ────────────────────────────────────────────────────
 * O unique de `UserNotificationDelivery` significa "já PROCESSEI esta
 * notificação pra este usuário", NÃO "já enviei". Tratar todo claim como
 * terminal transformaria qualquer adiamento em perda definitiva: a linha
 * ocuparia o dedupeKey para sempre e nenhuma execução futura tentaria de
 * novo. Por isso o claim é REIVINDICÁVEL — o sweep retoma o que ficou em
 * estado re-tentável:
 *   - `deferred` — fora da janela 7h-22h ou rate cap da hora estourado
 *   - `failed`   — erro no meio do envio
 *   - `pending`  órfão — a function morreu entre o claim e o `fetch`
 * Só `sent` e `skipped` (opt-out, gate do tenant fechado) são terminais:
 * nesses, insistir não muda o resultado.
 *
 * A retomada usa compare-and-swap (`updateMany` com o status no `where`), o
 * que mantém a garantia anti-duplicata quando duas execuções do cron se
 * sobrepõem: só uma consegue reivindicar.
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
import { filterUsersOptedIn, type OrgChannelCache } from "./user-prefs";
import {
  USER_NOTIF_CHANNELS,
  type UserNotifChannel,
} from "./user-channels-shared";
import { sendEmail } from "@/lib/email/client";
import { DealUpdateEmail } from "@/lib/email/templates/deal-update";
import {
  resolveNotificationUsers,
  type NotificationRowLite,
  type UserRecipient,
} from "./user-recipients";

/** Quantos envios um mesmo usuário pode receber por hora. */
export const MAX_PER_USER_PER_HOUR = 6;

/** Estados de onde o sweep reivindica de volta. */
const RETRIABLE_STATUSES = ["deferred", "failed"] as const;

/**
 * Um `pending` mais velho que isto é órfão. Folga maior que o `maxDuration`
 * do cron (60s) pra nunca competir com uma execução ainda viva.
 */
const PENDING_ORPHAN_MS = 10 * 60_000;

/** Janela padrão de novidade — evita disparar backlog ao ligar a feature. */
const DEFAULT_SINCE_MS = 30 * 60_000;

/**
 * Lookback da PRIMEIRA hora da janela (7h SP). O canal dorme das 22h às 7h;
 * sem estender aqui, tudo que nasceu durante a noite morreria sem nunca
 * entrar numa query — a notificação sairia da janela de 30 min enquanto o
 * sweep estava parado. Cobre as ~9h de gap com folga. Reprocessar não
 * duplica: quem já tem delivery terminal é pulado.
 */
const OVERNIGHT_SINCE_MS = 11 * 60 * 60_000;

const DEFAULT_LIMIT = 200;

/**
 * Teto de tempo do loop. O cron tem `maxDuration = 60`; parar antes disso
 * deixa o lote seguinte retomar de onde parou em vez de a function ser morta
 * no meio de um claim (que viraria `pending` órfão até o timeout acima).
 */
const SWEEP_BUDGET_MS = 45_000;

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
  // Só pra reconhecer o fan-out `:mgr` (ver MANAGER_BELL_SUFFIX abaixo).
  batchId: true,
} as const;

interface NotificationRow extends NotificationRowLite {
  title: string;
  body: string;
  batchId?: string | null;
}

/**
 * Sufixo do batchId das rows que `emitNotification` cria pro GERENTE do deal
 * (e `notifyChargeEvent`, no financeiro). Essas rows são **bell-only**: existem
 * pra que o sino do gerente — cuja leitura é restrita a notificações
 * direcionadas — mostre o evento. O canal EXTERNO dele (e-mail/WhatsApp dos
 * marcos) sai pelo motor lib/notifications/deal-events.ts, público `manager`,
 * com config por evento×canal e log próprio.
 *
 * Sem este skip o gerente receberia tudo em duplicata, por dois trilhos com
 * dedupes independentes que não se enxergam.
 */
const MANAGER_BELL_SUFFIX = ":mgr";

/** Caches por execução do sweep — a org repete em quase toda notificação. */
interface SweepCache {
  orgChannels: OrgChannelCache;
  orgName: Map<string, string | null>;
}

function newCache(): SweepCache {
  return { orgChannels: new Map(), orgName: new Map() };
}

async function orgNameOf(
  orgId: string,
  cache: SweepCache
): Promise<string | null> {
  const hit = cache.orgName.get(orgId);
  if (hit !== undefined) return hit;
  const org = await prisma.organization
    .findUnique({ where: { id: orgId }, select: { name: true } })
    .catch(() => null);
  const name = org?.name ?? null;
  cache.orgName.set(orgId, name);
  return name;
}

/**
 * Reivindica o direito de enviar. Retorna o id da linha, ou null quando
 * outra execução já entregou (terminal) ou está entregando agora.
 */
async function claimDelivery(params: {
  orgId: string;
  userId: string;
  notificationId: string;
  type: string;
  category: string;
  channel: UserNotifChannel;
  dedupeKey: string;
}): Promise<string | null> {
  const now = new Date();
  try {
    const row = await prisma.userNotificationDelivery.create({
      data: {
        ...params,
        status: "pending",
        attempts: 1,
        lastAttemptAt: now,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== "P2002"
    ) {
      throw err;
    }
  }

  // Já existe: só segue se estiver num estado de onde dá pra retomar.
  const existing = await prisma.userNotificationDelivery.findUnique({
    where: {
      userId_channel_dedupeKey: {
        userId: params.userId,
        channel: params.channel,
        dedupeKey: params.dedupeKey,
      },
    },
    select: { id: true, status: true },
  });
  if (!existing) return null;

  const orphanCutoff = new Date(Date.now() - PENDING_ORPHAN_MS);
  // Compare-and-swap: o status entra no `where`, então duas execuções
  // simultâneas não reivindicam a mesma linha.
  const claimed = await prisma.userNotificationDelivery.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: { in: [...RETRIABLE_STATUSES] } },
        { status: "pending", lastAttemptAt: { lt: orphanCutoff } },
        { status: "pending", lastAttemptAt: null },
      ],
    },
    data: {
      status: "pending",
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      settledAt: null,
    },
  });
  return claimed.count === 1 ? existing.id : null;
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
    .catch((err) => {
      // Não silencia: sem este log, uma linha presa em `pending` seria
      // invisível. Ela ainda é retomada pelo caminho de órfão acima.
      console.error(
        `[user-channels] settle(${id} → ${status}) falhou:`,
        err instanceof Error ? err.message : String(err)
      );
    });
}

/** Já estourou o teto de mensagens desta hora? */
async function isRateCapped(
  userId: string,
  channel: UserNotifChannel
): Promise<boolean> {
  try {
    const sent = await prisma.userNotificationDelivery.count({
      where: {
        userId,
        channel,
        status: "sent",
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    return sent >= MAX_PER_USER_PER_HOUR;
  } catch {
    // Falha aberta de propósito: o cap é defesa contra rajada, não contra
    // duplicata (disso cuida o claim). Bloquear por erro de contagem
    // transformaria indisponibilidade do banco em silêncio do canal.
    return false;
  }
}

/**
 * E-mail para usuário INTERNO. Reusa o mesmo template do aviso ao corretor
 * (`DealUpdateEmail`) e o `orgId`, que faz o branding da imobiliária entrar
 * sozinho (`lib/email/client.ts` → `renderWithBrand`).
 *
 * `forTeam` troca as duas frases que só fazem sentido pra corretor ("você
 * participa como corretor(a)", "fale com a imobiliária") — sem isso o e-mail
 * chegaria pra própria equipe dizendo que ela é parte externa.
 */
async function sendUserEmail(params: {
  notification: NotificationRow;
  user: UserRecipient;
  orgName: string | null;
}): Promise<{ ok: boolean; id: string | null; error?: string }> {
  const { notification, user, orgName } = params;
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  const ctaUrl = notification.linkUrl ? `${baseUrl}${notification.linkUrl}` : undefined;
  return sendEmail({
    to: user.email!,
    subject: notification.title,
    react: DealUpdateEmail({
      recipientName: user.name ?? "",
      eventTitle: notification.title,
      eventBody: notification.body,
      dealTitle: orgName ?? "",
      ctaUrl,
      ctaLabel: ctaUrl ? "Abrir no ImobPro" : undefined,
      forTeam: true,
    }),
    orgId: notification.orgId,
    tags: [
      { name: "kind", value: "user-notify" },
      { name: "type", value: notification.type },
    ],
  });
}

async function deliverToUser(params: {
  notification: NotificationRow;
  user: UserRecipient;
  category: string;
  channel: UserNotifChannel;
  orgName: string | null;
}): Promise<DeliveryStatus | "duplicate"> {
  const { notification, user, category, channel, orgName } = params;

  const deliveryId = await claimDelivery({
    orgId: notification.orgId,
    userId: user.userId,
    notificationId: notification.id,
    type: notification.type,
    category,
    channel,
    dedupeKey: `n:${notification.id}`,
  });
  if (!deliveryId) return "duplicate";

  // `deferred`, não `skipped`: a capacidade da hora se renova e o sweep
  // retoma esta mesma linha depois. Contado POR CANAL — o cap existe pra
  // conter rajada no WhatsApp, e deixar o e-mail comer esse orçamento faria
  // o canal intrusivo calar por causa do canal barato.
  if (await isRateCapped(user.userId, channel)) {
    await settleDelivery(deliveryId, "deferred", { reason: "rate_cap" });
    return "deferred";
  }

  if (channel === "email") {
    const r = await sendUserEmail({ notification, user, orgName });
    if (!r.ok) {
      await settleDelivery(deliveryId, "failed", { error: r.error ?? "sendEmail" });
      return "failed";
    }
    await settleDelivery(deliveryId, "sent", { emailId: r.id });
    return "sent";
  }

  const outcome = await triggerNewtonNotify({
    orgId: notification.orgId,
    audience: "platform_user",
    phone: user.phone!,
    recipientName: user.name ?? "",
    message: buildUserNotifyMessage(notification),
    orgName,
    linkUrl: notification.linkUrl,
  });

  if (outcome === "skipped") {
    // Terminal: gate do tenant fechado ou sidecar ausente não muda em
    // minutos, e insistir a cada 5 min só encheria a tabela.
    await settleDelivery(deliveryId, "skipped", {
      reason: "newton_gate_off_ou_sidecar_ausente",
    });
    return "skipped";
  }

  await settleDelivery(deliveryId, "sent", { via: "newton_sidecar" });
  return "sent";
}

export interface DispatchTotals {
  sent: number;
  skipped: number;
  deferred: number;
}

/**
 * Despacha UMA notificação. Nunca lança. `row` evita re-query quando o sweep
 * já carregou a linha; `cache` evita reconsultar org a cada notificação.
 */
export async function dispatchUserNotification(params: {
  notificationId: string;
  row?: NotificationRow;
  cache?: SweepCache;
}): Promise<DispatchTotals> {
  const zero: DispatchTotals = { sent: 0, skipped: 0, deferred: 0 };
  const cache = params.cache ?? newCache();
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

    // Fan-out bell-only pro gerente: pula ANTES de resolver destinatários — não
    // é uma linha que este canal deva entregar, e resolver/claimar geraria
    // linha de UserNotificationDelivery pra um envio que nunca deve sair.
    if (notification.batchId?.endsWith(MANAGER_BELL_SUFFIX)) return zero;

    const orgName = await orgNameOf(notification.orgId, cache);
    const result = { ...zero };

    // Cada canal resolve seus próprios destinatários: o contato exigido é
    // diferente (telefone vs e-mail) e a preferência é por canal, então quem
    // recebe por e-mail não é necessariamente quem recebe por WhatsApp.
    for (const channel of USER_NOTIF_CHANNELS) {
      const { users } = await resolveNotificationUsers(notification, channel);
      if (users.length === 0) continue;

      const allowed = await filterUsersOptedIn({
        userIds: users.map((u) => u.userId),
        orgId: notification.orgId,
        type: notification.type,
        category: policy.category,
        channel,
        cache: cache.orgChannels,
      });
      const targets = users.filter((u) => allowed.has(u.userId));
      if (targets.length === 0) continue;

      for (const user of targets) {
        // A janela vale só pro WhatsApp: e-mail não acorda ninguém às 23h, e
        // adiá-lo até as 7h atrasaria por nada. Checado por destinatário
        // porque a janela pode fechar no meio de um lote longo.
        if (channel === "whatsapp" && !isWithinWhatsappWindow()) {
          result.deferred += 1;
          continue;
        }
        const outcome = await deliverToUser({
          notification,
          user,
          category: policy.category,
          channel,
          orgName,
        });
        if (outcome === "sent") result.sent += 1;
        else if (outcome === "skipped") result.skipped += 1;
        else if (outcome === "deferred") result.deferred += 1;
      }
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

/** Lookback: estendido na primeira hora da janela pra cobrir a noite. */
function lookbackMs(now = new Date()): number {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );
  return hour === 7 ? OVERNIGHT_SINCE_MS : DEFAULT_SINCE_MS;
}

export interface SweepTotals extends DispatchTotals {
  scanned: number;
  /** Linhas retomadas de estado re-tentável (deferred/failed/órfão). */
  resumed: number;
  /** Sobrou trabalho? Sinaliza que o lote bateu o teto de tempo/limite. */
  truncated: boolean;
}

/**
 * Varre notificações recentes da allowlist + retoma entregas pendentes, e
 * despacha cada uma. Nunca lança — uma notificação problemática não derruba
 * o lote.
 */
export async function sweepUserNotifications(params?: {
  sinceMs?: number;
  limit?: number;
}): Promise<SweepTotals> {
  const limit = params?.limit ?? DEFAULT_LIMIT;
  const totals: SweepTotals = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    deferred: 0,
    resumed: 0,
    truncated: false,
  };

  // Fora da janela nem varre — economiza a query inteira.
  if (!isWithinWhatsappWindow()) return totals;

  const startedAt = Date.now();
  const sinceMs = params?.sinceMs ?? lookbackMs();

  try {
    // 1. Retomada: o que ficou adiado, falhou ou tem claim órfão. Vem antes
    //    das novidades porque já esperou mais.
    const orphanCutoff = new Date(Date.now() - PENDING_ORPHAN_MS);
    const resumable = await prisma.userNotificationDelivery.findMany({
      where: {
        channel: "whatsapp",
        notificationId: { not: null },
        OR: [
          { status: { in: [...RETRIABLE_STATUSES] } },
          { status: "pending", lastAttemptAt: { lt: orphanCutoff } },
        ],
      },
      select: { notificationId: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    const resumeIds = [
      ...new Set(
        resumable
          .map((r) => r.notificationId)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    totals.resumed = resumeIds.length;

    // 2. Novidades da janela de lookback.
    const fresh = (await prisma.notification.findMany({
      where: {
        type: { in: USER_CHANNEL_TYPES },
        createdAt: { gte: new Date(Date.now() - sinceMs) },
      },
      select: NOTIFICATION_SELECT,
      orderBy: { createdAt: "asc" },
      take: limit,
    })) as NotificationRow[];

    const seen = new Set(resumeIds);
    const queue: Array<{ id: string; row?: NotificationRow }> = [
      ...resumeIds.map((id) => ({ id })),
      ...fresh.filter((r) => !seen.has(r.id)).map((r) => ({ id: r.id, row: r })),
    ];

    totals.truncated = resumable.length === limit || fresh.length === limit;

    const cache = newCache();
    for (const item of queue) {
      // Para antes que o runtime mate a function no meio de um claim.
      if (Date.now() - startedAt > SWEEP_BUDGET_MS) {
        totals.truncated = true;
        break;
      }
      totals.scanned += 1;
      const r = await dispatchUserNotification({
        notificationId: item.id,
        row: item.row,
        cache,
      });
      totals.sent += r.sent;
      totals.skipped += r.skipped;
      totals.deferred += r.deferred;
    }

    if (totals.truncated) {
      console.warn(
        "[user-channels] sweep truncado — sobrou trabalho pro próximo lote",
        { scanned: totals.scanned, limit }
      );
    }
  } catch (err) {
    console.error(
      "[user-channels] sweepUserNotifications falhou:",
      err instanceof Error ? err.message : String(err)
    );
  }
  return totals;
}
