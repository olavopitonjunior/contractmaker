// Vínculo entre uma entidade local e o id dela na Superlógica.
// Extraído de `export-deal.ts` porque a sincronização de liquidação (PR 4)
// depende do MESMO registro: é ele que impede lançar a despesa do comissionado
// duas vezes quando o cron roda de novo.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

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
 * Chave da despesa de comissão: um lançamento por (negócio, favorecido).
 * O favorecido é o identificador que a própria Superlógica devolve para o
 * corretor — o mesmo que vai no `ID_FAVORECIDO_FAV` do lançamento.
 */
export function despesaKey(dealId: string, favorecidoId: string): string {
  return `deal:${dealId}:favorecido:${favorecidoId}`;
}
