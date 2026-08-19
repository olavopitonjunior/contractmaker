// Server-only por CONVENÇÃO (devolve fragmentos de where do Prisma).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Predicado ÚNICO de "2ª via viva" — a fonte de verdade compartilhada por
 * lista (page), filtro server e cron reconcile.
 *
 * A 2ª via tem DOIS instrumentos e o sinal de vida de cada um mora em tabela
 * diferente:
 *  - envelope → `Envelope { via: "reduzida", status running|closed }`;
 *  - aceite   → `ProposalSigner { role: "vendedor", acceptanceClicksignId }`
 *    com termo não-morto (o caminho de Aceite NUNCA materializa Envelope).
 *
 * Olhar só envelope marcava toda proposta de Aceite em aguardando_vendedor
 * como "2ª via falhou" e fazia o cron redisparar todas, todo dia, pra sempre.
 */

/** Statuses de termo de Aceite que contam como via VIVA (sent = aguardando o
 *  proprietário; completed = ele respondeu). `expired`/`canceled` são mortos —
 *  esses PRECISAM aparecer como falha e ser reemitidos. `refused` é desfecho
 *  legítimo tratado pelo webhook (recusada_*), não passa por aqui. */
export const LIVE_ACCEPTANCE_STATUSES = ["sent", "completed"] as const;

export const LIVE_REDUZIDA_ENVELOPE: Prisma.EnvelopeWhereInput = {
  via: "reduzida",
  status: { in: ["running", "closed"] },
};

export const LIVE_VENDEDOR_ACCEPTANCE: Prisma.ProposalSignerWhereInput = {
  role: "vendedor",
  included: true,
  acceptanceClicksignId: { not: null },
  acceptanceStatus: { in: [...LIVE_ACCEPTANCE_STATUSES] },
};

/** Where de proposta SEM nenhuma forma de 2ª via viva ("2ª via falhou"). */
export function noLiveVendedorViaWhere(): Prisma.ProposalWhereInput {
  return {
    envelopes: { none: LIVE_REDUZIDA_ENVELOPE },
    signers: { none: LIVE_VENDEDOR_ACCEPTANCE },
  };
}

/**
 * Resolve em batch (2 queries, sem N+1) quais das propostas têm 2ª via viva.
 */
export async function resolveLiveVendedorVia(proposalIds: string[]): Promise<Set<string>> {
  if (proposalIds.length === 0) return new Set();
  const [liveEnvelopes, liveAcceptances] = await Promise.all([
    prisma.envelope.findMany({
      where: { proposalId: { in: proposalIds }, ...LIVE_REDUZIDA_ENVELOPE },
      select: { proposalId: true },
    }),
    prisma.proposalSigner.findMany({
      where: { proposalId: { in: proposalIds }, ...LIVE_VENDEDOR_ACCEPTANCE },
      select: { proposalId: true },
    }),
  ]);
  const live = new Set<string>();
  for (const e of liveEnvelopes) if (e.proposalId) live.add(e.proposalId);
  for (const s of liveAcceptances) live.add(s.proposalId);
  return live;
}
