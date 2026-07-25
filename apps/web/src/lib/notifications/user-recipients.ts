/**
 * Quem, entre os USUÁRIOS da plataforma, deve receber uma notificação em
 * canal externo.
 *
 * Duas partes:
 *
 *  1. **Cascata**, que PARA no primeiro passo que resolver — nunca faz
 *     broadcast por OrgMembership. O pior caso é um punhado de admins, e só
 *     quando a notificação é genuinamente org-wide e sem deal.
 *  2. **Lista escolhida pelo admin** (`settingsJson.userRecipients`), que SOMA
 *     ao resultado da cascata, para qualquer negócio da org.
 *
 * A parte 2 existe porque a cascata resolve no dono do negócio, e há quem
 * precise saber de tudo sem ser dono de nada — a negociadora que acompanha o
 * processo inteiro é o caso que motivou. Continua não sendo broadcast: é uma
 * lista explícita, finita e limitada pelo mesmo teto.
 */

import { prisma } from "@/lib/db/prisma";
import {
  orgSelectedUserIds,
  type UserNotifChannel,
} from "./user-channels-shared";

/** Teto duro de destinatários por notificação. */
export const MAX_RECIPIENTS_PER_NOTIFICATION = 5;

export type RecipientRule =
  | "direct"
  | "deal_owner"
  | "org_admins"
  | "org_selected"
  | "none";

export interface UserRecipient {
  userId: string;
  name: string | null;
  /** E.164 (User.phone). Não-nulo quando o canal é whatsapp. */
  phone: string | null;
  /** User.email — obrigatório no schema, então sempre presente. */
  email: string | null;
}

export interface NotificationRowLite {
  id: string;
  orgId: string;
  userId: string | null;
  type: string;
  linkUrl: string | null;
  metadata: unknown;
}

/** `/deals/<id>` e `/locacao/deals/<id>` — usado só como rede de segurança. */
const DEAL_LINK_RE = /^\/(?:locacao\/)?deals\/([A-Za-z0-9_-]{20,})/;

function dealIdFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const dealId = (metadata as { dealId?: unknown }).dealId;
  return typeof dealId === "string" && dealId.length > 0 ? dealId : null;
}

function dealIdFromLinkUrl(linkUrl: string | null): string | null {
  if (!linkUrl) return null;
  return DEAL_LINK_RE.exec(linkUrl)?.[1] ?? null;
}

/**
 * Carrega os usuários elegíveis: contato do CANAL preenchido, conta viva e
 * membro ATUAL da org. A checagem de membership é o que impede um ex-membro
 * de receber por uma notificação antiga ainda na janela do sweep.
 */
async function loadEligible(
  userIds: string[],
  orgId: string,
  channel: UserNotifChannel
): Promise<UserRecipient[]> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return [];

  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, userId: { in: unique } },
    select: {
      userId: true,
      user: { select: { name: true, phone: true, email: true, deletedAt: true } },
    },
  });

  const out: UserRecipient[] = [];
  for (const m of memberships) {
    if (m.user?.deletedAt) continue;
    // O contato exigido é o DO CANAL. Filtrar e-mail por telefone faria sumir
    // justamente quem só usa e-mail — e `User.email` é obrigatório no schema,
    // então o canal e-mail nunca perde ninguém por falta de contato.
    if (channel === "whatsapp" && !m.user?.phone) continue;
    if (channel === "email" && !m.user?.email) continue;
    out.push({
      userId: m.userId,
      name: m.user?.name ?? null,
      phone: m.user?.phone ?? null,
      email: m.user?.email ?? null,
    });
  }
  return out;
}

/**
 * Aplica o teto de destinatários. Corte silencioso lê como "avisei todos"
 * quando não avisou — então quem sobrou fica no log, nominalmente.
 *
 * `loadEligible` já deduplica por userId, então quem é dono do negócio E está
 * na lista escolhida aparece uma vez só.
 */
function capped(users: UserRecipient[], notificationId: string): UserRecipient[] {
  if (users.length <= MAX_RECIPIENTS_PER_NOTIFICATION) return users;
  const kept = users.slice(0, MAX_RECIPIENTS_PER_NOTIFICATION);
  const dropped = users.slice(MAX_RECIPIENTS_PER_NOTIFICATION);
  console.warn(
    `[user-recipients] notificação ${notificationId}: teto de ${MAX_RECIPIENTS_PER_NOTIFICATION} ` +
      `destinatários atingido — ${dropped.length} fora: ${dropped.map((u) => u.userId).join(", ")}`
  );
  return kept;
}

/**
 * Os userIds com alcance org-wide nesta org. Nunca lança: sem lista, ou erro
 * de leitura, devolve vazio e a cascata segue sozinha.
 */
async function loadOrgSelected(orgId: string): Promise<string[]> {
  try {
    const row = await prisma.orgNotificationSettings.findUnique({
      where: { orgId },
      select: { settingsJson: true },
    });
    return orgSelectedUserIds(row?.settingsJson);
  } catch (err) {
    console.error("[user-recipients] falha ao ler destinatários da org:", err);
    return [];
  }
}

/**
 * Resolve os destinatários de uma notificação. Nunca lança — erro de DB vira
 * `{ users: [], rule: "none" }` e o chamador registra o skip.
 *
 * `channel` decide qual CONTATO é exigido (telefone no WhatsApp, e-mail no
 * e-mail) — resolver os dois com o mesmo filtro faria quem só tem e-mail
 * desaparecer do canal que ela de fato usa.
 */
export async function resolveNotificationUsers(
  n: NotificationRowLite,
  channel: UserNotifChannel = "whatsapp"
): Promise<{ users: UserRecipient[]; rule: RecipientRule }> {
  try {
    const selected = await loadOrgSelected(n.orgId);

    // 1. Notificação direcionada: o alvo já está declarado, e só ele.
    // Direcionada é privada (o sino esconde dos outros), então a lista da org
    // NÃO soma aqui — somar vazaria uma notificação pessoal pra terceiros.
    if (n.userId) {
      const users = await loadEligible([n.userId], n.orgId, channel);
      return { users, rule: "direct" };
    }

    // 2. Ancorada num deal → dono do negócio, MAIS os escolhidos pelo admin.
    const dealId = dealIdFromMetadata(n.metadata) ?? dealIdFromLinkUrl(n.linkUrl);
    if (dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: { userId: true, pipeline: { select: { orgId: true } } },
      });
      // Guard cross-org: a notificação não pode arrastar dono de outro tenant.
      if (deal?.userId && deal.pipeline.orgId === n.orgId) {
        const users = await loadEligible([deal.userId, ...selected], n.orgId, channel);
        return {
          users: capped(users, n.id),
          rule: selected.length > 0 ? "org_selected" : "deal_owner",
        };
      }
    }

    // 3. Org-wide sem deal → owners/admins, limitado. Os escolhidos entram
    // junto: quem foi marcado deve receber mesmo que não seja admin.
    const admins = await prisma.orgMembership.findMany({
      where: { orgId: n.orgId, role: { in: ["owner", "admin"] } },
      select: { userId: true },
      take: MAX_RECIPIENTS_PER_NOTIFICATION,
    });
    const orgWide = [...selected, ...admins.map((a) => a.userId)];
    if (orgWide.length > 0) {
      const users = await loadEligible(orgWide, n.orgId, channel);
      return {
        users: capped(users, n.id),
        rule: selected.length > 0 ? "org_selected" : "org_admins",
      };
    }

    // 4. Sem deal e sem admin, mas com lista escolhida — org sem owner/admin
    // vivo é raro, mas a lista não deve morrer por isso.
    if (selected.length > 0) {
      const users = await loadEligible(selected, n.orgId, channel);
      if (users.length > 0) {
        return { users: capped(users, n.id), rule: "org_selected" };
      }
    }

    return { users: [], rule: "none" };
  } catch (err) {
    console.error(
      "[user-recipients] falha ao resolver destinatários:",
      err instanceof Error ? err.message : String(err)
    );
    return { users: [], rule: "none" };
  }
}
