// Server-only por CONVENÇÃO (sem o pacote "server-only", que não é dep):
// devolve `Prisma.ProposalWhereInput` — importar isto num client component
// quebraria o build de qualquer jeito.
import type { Prisma } from "@prisma/client";
import { statusesForFilter, STATUS_FILTERS } from "./list-filters";

/**
 * Resolve o `where` COMPLETO de um filtro da lista — inclusive os que precisam
 * de condição de banco além do status. Vive separado do list-filters.ts porque
 * aquele é importado por client component ("use client") e um where do Prisma
 * não pode vazar pro bundle do browser.
 *
 * "2ª via falhou" = `aguardando_vendedor` SEM envelope reduzida vivo
 * (running/closed): o envio ao proprietário não materializou envelope (crash,
 * preflight tardio, cancelamento) — são as propostas que o corretor precisa
 * reenviar.
 */
export function proposalListWhereForFilter(
  id: string | undefined | null
): Prisma.ProposalWhereInput {
  if (id === "segunda_via_falhou") {
    return {
      status: "aguardando_vendedor",
      envelopes: { none: { via: "reduzida", status: { in: ["running", "closed"] } } },
    };
  }
  const statuses = statusesForFilter(id);
  return statuses ? { status: { in: statuses } } : {};
}

export function filterRequiresServer(id: string | undefined | null): boolean {
  return Boolean(id && STATUS_FILTERS.find((f) => f.id === id)?.requiresServer);
}
