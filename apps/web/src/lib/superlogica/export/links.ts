// Vínculo entre uma entidade local e o id dela na Superlógica.
// Extraído de `export-deal.ts` porque a sincronização de liquidação (PR 4)
// depende do MESMO registro: é ele que impede lançar a despesa do comissionado
// duas vezes quando o cron roda de novo.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/** `remoteId` de uma reserva ainda não confirmada pela Superlógica. */
export const LINK_PENDING = "pending";

/** `entityType` conhecidos. `despesa` é do cron de liquidação. */
export type SuperlogicaEntityType = "pessoa" | "corretor" | "imovel" | "venda" | "despesa";

export async function getLink(orgId: string, entityType: SuperlogicaEntityType, localKey: string) {
  return prisma.superlogicaLink.findUnique({
    where: { orgId_entityType_localKey: { orgId, entityType, localKey } },
  });
}

export async function putLink(
  orgId: string,
  entityType: SuperlogicaEntityType,
  localKey: string,
  remoteId: string,
  remoteAux: string | null,
  snapshot: Prisma.InputJsonValue | null,
) {
  const snapshotJson = snapshot ?? undefined;
  return prisma.superlogicaLink.upsert({
    where: { orgId_entityType_localKey: { orgId, entityType, localKey } },
    create: { orgId, entityType, localKey, remoteId, remoteAux, snapshotJson },
    update: { remoteId, remoteAux, snapshotJson, lastSyncedAt: new Date() },
  });
}

/**
 * RESERVA a chave antes do efeito colateral, como o claim da exportação faz.
 *
 * Ler-depois-escrever não serve para dinheiro: entre o `getLink` e o `putLink`
 * há uma chamada de rede, e duas execuções do cron passariam juntas pela
 * leitura e pagariam duas vezes. Aqui quem cria a linha vence; a segunda
 * execução toma o erro de unicidade e desiste.
 *
 * Devolve `null` quando a chave já estava reservada (por outro processo ou por
 * uma execução anterior).
 */
export async function claimLink(
  orgId: string,
  entityType: SuperlogicaEntityType,
  localKey: string,
): Promise<{ id: string } | null> {
  try {
    return await prisma.superlogicaLink.create({
      data: { orgId, entityType, localKey, remoteId: LINK_PENDING },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

/** Confirma a reserva com o id que a Superlógica devolveu. */
export async function completeLink(
  id: string,
  remoteId: string,
  remoteAux: string | null,
  snapshot: Prisma.InputJsonValue | null,
) {
  return prisma.superlogicaLink.update({
    where: { id },
    data: { remoteId, remoteAux, snapshotJson: snapshot ?? undefined, lastSyncedAt: new Date() },
  });
}

/**
 * Chave da despesa de comissão: um lançamento por (negócio, favorecido).
 * O favorecido é o identificador que a própria Superlógica devolve para o
 * corretor — o mesmo que vai no `ID_FAVORECIDO_FAV` do lançamento.
 */
export function despesaKey(dealId: string, favorecidoId: string): string {
  return `deal:${dealId}:favorecido:${favorecidoId}`;
}
