/**
 * Quem, entre os USUÁRIOS da plataforma, deve receber uma notificação em
 * canal externo.
 *
 * Cascata que PARA no primeiro passo que resolver — nunca soma passos, nunca
 * faz broadcast por OrgMembership. O pior caso é um punhado de admins, e só
 * quando a notificação é genuinamente org-wide e sem deal.
 */

import { prisma } from "@/lib/db/prisma";

/** Teto duro de destinatários por notificação. */
export const MAX_RECIPIENTS_PER_NOTIFICATION = 5;

export type RecipientRule = "direct" | "deal_owner" | "org_admins" | "none";

export interface UserRecipient {
  userId: string;
  name: string | null;
  /** E.164 (User.phone). Garantido não-nulo — quem não tem é filtrado antes. */
  phone: string;
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
 * Carrega os usuários elegíveis: telefone preenchido, conta viva e membro
 * ATUAL da org. A checagem de membership é o que impede um ex-membro de
 * receber por uma notificação antiga ainda na janela do sweep.
 */
async function loadEligible(
  userIds: string[],
  orgId: string
): Promise<UserRecipient[]> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return [];

  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, userId: { in: unique } },
    select: {
      userId: true,
      user: { select: { name: true, phone: true, deletedAt: true } },
    },
  });

  const out: UserRecipient[] = [];
  for (const m of memberships) {
    if (!m.user?.phone) continue;
    if (m.user.deletedAt) continue;
    out.push({ userId: m.userId, name: m.user.name, phone: m.user.phone });
  }
  return out;
}

/**
 * Resolve os destinatários de uma notificação. Nunca lança — erro de DB vira
 * `{ users: [], rule: "none" }` e o chamador registra o skip.
 */
export async function resolveNotificationUsers(
  n: NotificationRowLite
): Promise<{ users: UserRecipient[]; rule: RecipientRule }> {
  try {
    // 1. Notificação direcionada: o alvo já está declarado, e só ele.
    if (n.userId) {
      const users = await loadEligible([n.userId], n.orgId);
      return { users, rule: "direct" };
    }

    // 2. Ancorada num deal → dono do negócio.
    const dealId = dealIdFromMetadata(n.metadata) ?? dealIdFromLinkUrl(n.linkUrl);
    if (dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: { userId: true, pipeline: { select: { orgId: true } } },
      });
      // Guard cross-org: a notificação não pode arrastar dono de outro tenant.
      if (deal?.userId && deal.pipeline.orgId === n.orgId) {
        const users = await loadEligible([deal.userId], n.orgId);
        return { users, rule: "deal_owner" };
      }
    }

    // 3. Org-wide sem deal → owners/admins, limitado.
    const admins = await prisma.orgMembership.findMany({
      where: { orgId: n.orgId, role: { in: ["owner", "admin"] } },
      select: { userId: true },
      take: MAX_RECIPIENTS_PER_NOTIFICATION,
    });
    if (admins.length > 0) {
      const users = await loadEligible(
        admins.map((a) => a.userId),
        n.orgId
      );
      return {
        users: users.slice(0, MAX_RECIPIENTS_PER_NOTIFICATION),
        rule: "org_admins",
      };
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
