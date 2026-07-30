/**
 * Resolvedor do destinatário "gerente" de um deal — o público v3 das
 * notificações do processo (v1 corretores, v2 partes).
 *
 * O gerente é UM usuário da plataforma (`Deal.managerUserId`), não uma lista:
 * o fan-out é sempre de um destinatário só. A elegibilidade espelha
 * `loadEligible` de user-recipients.ts — membro ATUAL da org e conta viva —
 * porque um gerente que saiu da imobiliária (ou teve a conta apagada por LGPD)
 * não pode continuar recebendo por um deal antigo que ainda o aponta.
 *
 * Diferente do corretor (SplitRecipient, cadastro comercial da org) e da parte
 * (contato no dataJson do form), aqui o contato é o do próprio USER — e-mail
 * obrigatório no schema, telefone opcional em E.164 COM "+".
 */

import { prisma } from "@/lib/db/prisma";

export interface ManagerRecipient {
  userId: string;
  label: string;
  email: string | null;
  /** E.164 COM "+" (User.phone) — cru; quem normaliza é o trigger do Newton. */
  phone: string | null;
}

/**
 * O gerente do deal, se houver um elegível. Nunca lança: erro de DB vira null
 * e o motor simplesmente não envia (o catch global dele registra o resto).
 */
export async function resolveDealManager(params: {
  managerUserId: string | null;
  orgId: string;
}): Promise<ManagerRecipient | null> {
  const { managerUserId, orgId } = params;
  if (!managerUserId) return null;

  try {
    // Membership é o filtro, não o User: só quem é membro ATUAL desta org pode
    // ser alcançado (o mesmo guard cross-org que a cascata do sino aplica).
    const membership = await prisma.orgMembership.findFirst({
      where: { orgId, userId: managerUserId },
      select: {
        userId: true,
        user: { select: { name: true, email: true, phone: true, deletedAt: true } },
      },
    });
    if (!membership?.user || membership.user.deletedAt) return null;

    const { name, email, phone } = membership.user;
    const label = name?.trim() || email;
    // Sem nome E sem e-mail não há como rotular a linha do log nem escrever —
    // não deveria acontecer (email é obrigatório no schema), mas o log do
    // negócio não pode ganhar uma linha anônima por causa de dado sujo.
    if (!label) return null;

    return {
      userId: membership.userId,
      label,
      email: email ?? null,
      phone: phone ?? null,
    };
  } catch (err) {
    console.error(
      "[deal-manager] falha ao resolver gerente do negócio:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
