import { prisma } from "@/lib/db/prisma";

/**
 * Quantas pessoas o Max ALCANÇA numa org — a única fonte dessa conta.
 *
 * Existia em duas cópias (a etapa do onboarding e o card de `/settings`), que é
 * o jeito mais rápido de as duas telas discordarem sobre o mesmo fato. E as
 * duas cópias erravam junto, do mesmo jeito.
 *
 * ── As duas regras que a conta ingênua errava ─────────────────────────────
 *
 * 1. **Opt-in não basta: precisa de TELEFONE.** `user-recipients.ts` recusa
 *    quem não tem (`if (channel === "whatsapp" && !m.user?.phone) continue`).
 *    Contar só `whatsappOptInAt` fazia a etapa do onboarding fechar afirmando
 *    que alguém recebe quando ninguém recebia — a mesma classe de erro do
 *    "ativo sem confirmação" que a leitura por `deliveredAt` existe pra evitar.
 *
 * 2. **A membership do próprio Max não é uma pessoa.** O usuário de serviço é
 *    membro `viewer` da org (`isSystem: true`), e sem filtrar ele entrava no
 *    total como alguém "sem telefone no perfil". Numa org de um sócio só, o
 *    card dizia que faltava cadastrar o telefone de alguém — e esse alguém era
 *    o bot, então não havia o que fazer pra zerar o aviso.
 *
 * `UserNotificationPreference` também não some quando a pessoa sai da org: o
 * cascade é de `User` e `Organization`, não de membership. Por isso o opt-in é
 * cruzado com uma membership viva, e não lido solto.
 */
export interface MaxReach {
  /** Pessoas de verdade na org — sem o usuário de serviço. */
  membersTotal: number;
  /** Dessas, quantas têm telefone no perfil. */
  membersWithPhone: number;
  /** Quantas de fato receberiam: telefone + opt-in + membership viva. */
  optedIn: number;
}

export async function getMaxReach(orgId: string): Promise<MaxReach> {
  const humano = { deletedAt: null } as const;

  const [membersTotal, membersWithPhone, optedIn] = await Promise.all([
    prisma.orgMembership.count({
      where: { orgId, isSystem: false, user: humano },
    }),
    prisma.orgMembership.count({
      where: { orgId, isSystem: false, user: { ...humano, phone: { not: null } } },
    }),
    prisma.userNotificationPreference.count({
      where: {
        orgId,
        whatsappOptInAt: { not: null },
        user: {
          ...humano,
          phone: { not: null },
          orgMemberships: { some: { orgId, isSystem: false } },
        },
      },
    }),
  ]);

  return { membersTotal, membersWithPhone, optedIn };
}
