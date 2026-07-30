import { prisma } from "@/lib/db/prisma";

/**
 * Config efetiva de gerente da org. Row ausente = defaults (toggle off, sem
 * overrides) — o GET das settings e os fluxos de criação usam esta leitura.
 */
export async function getManagerSettings(orgId: string): Promise<{
  managerRequired: boolean;
  permissionsJson: Record<string, boolean>;
}> {
  const row = await prisma.orgManagerSettings.findUnique({
    where: { orgId },
    select: { managerRequired: true, permissionsJson: true },
  });
  return {
    managerRequired: row?.managerRequired ?? false,
    permissionsJson: (row?.permissionsJson ?? {}) as Record<string, boolean>,
  };
}

export type ManagerResolution =
  | { ok: true; managerUserId: string | null }
  | { ok: false; status: 400 | 422; error: string; message: string };

/**
 * Resolve/valida o gerente na CRIAÇÃO de negócio (vendas e locação — todos os
 * 7 endpoints de criação passam por aqui antes do prisma.deal.create).
 *
 * - Toggle `managerRequired` ligado + gerente ausente → 422 `gerente_obrigatorio`
 *   (uniforme pra UI e bearer/Newton — sem default silencioso: a obrigatoriedade
 *   é escolha explícita da org e um default mascararia o dado errado).
 * - Gerente informado → valida OrgMembership (molde do assignee de proposta).
 *   NÃO restringe ao role `gerente`: admin/sales também podem gerenciar um deal
 *   (o picker da UI filtra por role; o server só exige membership).
 */
export async function resolveManagerForCreate(
  orgId: string,
  managerUserId: string | undefined | null
): Promise<ManagerResolution> {
  const { managerRequired } = await getManagerSettings(orgId);

  if (!managerUserId) {
    if (managerRequired) {
      return {
        ok: false,
        status: 422,
        error: "gerente_obrigatorio",
        message:
          "Esta organização exige um gerente responsável em todo negócio novo. Informe managerUserId.",
      };
    }
    return { ok: true, managerUserId: null };
  }

  const member = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: managerUserId, orgId } },
    select: { userId: true },
  });
  if (!member) {
    return {
      ok: false,
      status: 400,
      error: "gerente_invalido",
      message: "O gerente informado não é membro desta organização.",
    };
  }
  return { ok: true, managerUserId };
}
