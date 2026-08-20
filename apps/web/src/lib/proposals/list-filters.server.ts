// Server-only por CONVENÇÃO (sem o pacote "server-only", que não é dep):
// devolve `Prisma.ProposalWhereInput` — importar isto num client component
// quebraria o build de qualquer jeito.
import type { Prisma } from "@prisma/client";
import { statusesForFilter } from "./list-filters";
import { noLiveVendedorViaWhere } from "./live-vendedor-via";
import { sendCanceledWhere, notSendCanceledWhere } from "./send-canceled-where";

/**
 * Resolve o `where` COMPLETO de um filtro da lista — inclusive os que precisam
 * de condição de banco além do status. Vive separado do list-filters.ts porque
 * aquele é importado por client component ("use client") e um where do Prisma
 * não pode vazar pro bundle do browser.
 *
 * "2ª via falhou" = `aguardando_vendedor` SEM 2ª via viva em NENHUM
 * instrumento (envelope reduzida OU termo de Aceite do vendedor — o predicado
 * único vive em live-vendedor-via.ts): o envio ao proprietário não vingou
 * (crash, preflight tardio, cancelamento, termo expirado) — são as propostas
 * que o corretor precisa reenviar.
 */
export function proposalListWhereForFilter(
  id: string | undefined | null
): Prisma.ProposalWhereInput {
  // Os dois lados da partição de `falha_envio` usam o MESMO predicado
  // (sendCanceledWhere) — um afirmado, outro negado. É isso que garante que
  // toda falha_envio cai em exatamente UM dos dois chips; dois wheres escritos
  // à mão divergiriam na primeira manutenção.
  if (id === "envio_cancelado") {
    return { status: "falha_envio", ...sendCanceledWhere() };
  }
  if (id === "rascunho") {
    // Embrulhado em AND de propósito — NUNCA devolver `OR` no topo deste
    // resolver: page.tsx compõe `{ ...scope, ...statusWhere }` por SPREAD, e o
    // escopo de PROPOSAL_VIEW_OWN_ONLY (rbac/check.ts) também é `{ orgId,
    // OR: [...] }`. Chave repetida no spread vence em silêncio: um OR aqui
    // apagaria o do escopo e o corretor veria rascunho/falha da ORG INTEIRA.
    // Há teste travando as chaves proibidas de todos os filtros.
    return {
      AND: [
        {
          OR: [
            { status: { in: ["rascunho", "aguardando_aprovacao"] } },
            { status: "falha_envio", ...notSendCanceledWhere() },
          ],
        },
      ],
    };
  }
  if (id === "segunda_via_falhou") {
    return {
      status: "aguardando_vendedor",
      ...noLiveVendedorViaWhere(),
    };
  }
  const statuses = statusesForFilter(id);
  return statuses ? { status: { in: statuses } } : {};
}

