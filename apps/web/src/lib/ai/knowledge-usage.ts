/**
 * Contagem de uso de cláusula, por tenant.
 *
 * `KnowledgeItem.usageCount` é global e continua sendo mantido — a tela de
 * cláusulas e o `find_similar_contracts` leem de lá. O que ele NÃO pode mais
 * fazer sozinho é ordenar o `expert-context`: aquele bloco entra no prompt de
 * todo turn em modo Planejar, e com a base de plataforma um tenant que insere a
 * mesma cláusula universal muitas vezes passaria a deslocar o preâmbulo do
 * agente de outro tenant.
 *
 * Os dois contadores andam juntos: o global mede popularidade do item, o por-org
 * mede o hábito daquela imobiliária. Quem ordena preâmbulo usa o segundo.
 */

import { prisma } from "@/lib/db/prisma";

/**
 * Soma 1 no contador global e no da org. Best-effort nos dois: contagem de uso
 * não pode derrubar uma inserção de cláusula nem a criação de memória.
 */
export async function incrementClauseUsage(
  knowledgeItemId: string,
  orgId: string | null | undefined
): Promise<void> {
  await prisma.knowledgeItem
    .update({
      where: { id: knowledgeItemId },
      data: { usageCount: { increment: 1 } },
    })
    .catch((err) => {
      console.error("[knowledge-usage] incremento global falhou:", err);
    });

  if (!orgId) return;

  // `upsert` sobre o @@unique, não findFirst+create: dois turns simultâneos no
  // mesmo contrato colidiriam na janela entre ler e criar.
  await prisma.knowledgeItemUsage
    .upsert({
      where: { knowledgeItemId_orgId: { knowledgeItemId, orgId } },
      create: { knowledgeItemId, orgId, count: 1 },
      update: { count: { increment: 1 } },
    })
    .catch((err) => {
      console.error("[knowledge-usage] incremento por org falhou:", err);
    });
}

/**
 * Uso por org de um conjunto de itens: `knowledgeItemId → count`.
 *
 * Existe porque o Prisma não sabe `orderBy` um agregado de relação — o
 * `expert-context` precisa ordenar cláusulas de PLATAFORMA pelo contador
 * daquela org, e isso vira duas consultas com merge em memória.
 */
export async function usageCountsForOrg(
  orgId: string,
  knowledgeItemIds: string[]
): Promise<Map<string, number>> {
  if (knowledgeItemIds.length === 0) return new Map();
  const rows = await prisma.knowledgeItemUsage.findMany({
    where: { orgId, knowledgeItemId: { in: knowledgeItemIds } },
    select: { knowledgeItemId: true, count: true },
  });
  return new Map(rows.map((r) => [r.knowledgeItemId, r.count]));
}
