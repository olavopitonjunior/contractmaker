import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Serializa uma checagem-e-ação de budget por org usando advisory lock do
 * Postgres. Sem isso, o padrão read-agregado→cria tem TOCTOU: duas requests
 * paralelas leem o mesmo gasto acumulado, ambas passam o teto e ambas gastam
 * (envelope ClickSign real, transfer, tokens de IA).
 *
 * `pg_advisory_xact_lock` é reentrante por transação e liberado automaticamente
 * no commit/rollback. A chave é derivada de um namespace + orgId, então locks
 * de escopos diferentes (ex.: clicksign vs infosimples) não colidem.
 *
 * O callback recebe o client transacional — TODAS as leituras/escritas do
 * check devem usar `tx` pra ficarem sob o mesmo lock.
 */
export async function withOrgBudgetLock<T>(
  namespace: string,
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Dois int32 estáveis a partir de hash do namespace e do orgId — a forma
    // de 2 argumentos do advisory lock evita colisão entre namespaces.
    const nsKey = hash32(namespace);
    const orgKey = hash32(orgId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${nsKey}::int, ${orgKey}::int)`;
    return fn(tx);
  });
}

/** FNV-1a 32-bit → int32 assinado (range aceito pelo pg_advisory_xact_lock). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Converte pra int32 assinado.
  return h | 0;
}
