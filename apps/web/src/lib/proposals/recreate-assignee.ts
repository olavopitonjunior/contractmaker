/**
 * Quem fica responsável pela proposta RECRIADA.
 *
 * Regra de negócio pequena e cheia de casos de borda, que vivia inline no
 * server component de `/pipeline/propostas/nova` — onde não dava pra testar
 * sem levantar Prisma e sessão inteiros. Extraída para poder ser exercitada
 * caso a caso; o comportamento é o mesmo.
 */
export interface RecreationAssigneeInput {
  /** O ator tem PROPOSAL_ASSIGN? Sem isso o POST recusaria o campo. */
  canAssign: boolean;
  responsibleUserId: string | null;
  /** Responsável EXTERNO: nome livre, sem usuário na plataforma. */
  responsibleName: string | null;
  /** Ids de quem ainda é membro da org. */
  memberIds: readonly string[];
}

export interface RecreationAssignee {
  responsibleUserId?: string;
  responsibleName?: string;
}

export function resolveRecreationAssignee(
  input: RecreationAssigneeInput
): RecreationAssignee {
  // Sem permissão de atribuir, o responsável cai pro criador — que é o
  // comportamento padrão da criação comum.
  if (!input.canAssign) return {};

  if (input.responsibleUserId) {
    // Ex-membro: remover a membership NÃO anula `responsibleUserId`, então o
    // id pode apontar pra quem não aparece mais no Select. Herdar nesse caso
    // deixaria o campo inválido e estouraria 400 no POST.
    return input.memberIds.includes(input.responsibleUserId)
      ? { responsibleUserId: input.responsibleUserId }
      : {};
  }

  // Responsável externo — estado suportado pelo schema e pelo PATCH /assignee.
  // Sem repassar, a recriação trocaria o dono da atribuição em silêncio.
  const nome = input.responsibleName?.trim();
  return nome ? { responsibleName: nome } : {};
}
