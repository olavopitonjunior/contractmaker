import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Máquina de estados da Proposal.
 *
 * status é PERSISTIDO (o cron de expiração e a listagem filtram por ele). As
 * transições usam CAS (compare-and-swap) via updateMany com os predecessores
 * permitidos — nunca `update({ where:{id}, data:{status} })`, que sobrescreveria
 * um estado mais avançado.
 */

export type ProposalStatus =
  | "rascunho"
  | "aguardando_aprovacao"
  | "enviada"
  | "entregue"
  | "visualizada"
  | "assinada_proponente"
  | "aguardando_vendedor"
  | "completa"
  | "convertida"
  | "recusada_proponente"
  | "recusada_vendedor"
  | "expirada"
  | "cancelada"
  | "falha_envio";

/**
 * Predecessores válidos de cada destino. Precisa ser COMPLETO: um proponente
 * que assina pelo link nativo da ClickSign sem nunca abrir nossa landing vai de
 * `enviada` direto pra `assinada_proponente` — se só admitíssemos `visualizada`,
 * a assinatura sumiria no CAS.
 */
export const ALLOWED_FROM: Record<ProposalStatus, ProposalStatus[]> = {
  rascunho: [],
  aguardando_aprovacao: ["rascunho"],
  enviada: ["rascunho", "aguardando_aprovacao"],
  entregue: ["enviada"],
  visualizada: ["enviada", "entregue"],
  assinada_proponente: ["enviada", "entregue", "visualizada"],
  aguardando_vendedor: ["assinada_proponente"],
  completa: ["assinada_proponente", "aguardando_vendedor"],
  convertida: ["completa", "assinada_proponente", "aguardando_vendedor"],
  // Recusa pode vir de qualquer estado ativo. `recusada_vendedor` também
  // admite os estados PRÉ-assinatura: na via ÚNICA (proponente + proprietário
  // no mesmo envelope) e no Aceite multi-termo, o proprietário pode recusar
  // ANTES do proponente assinar — sem esses estados, a transição era CAS-
  // rejeitada e a proposta ficava presa em "enviada" pra sempre.
  recusada_proponente: ["enviada", "entregue", "visualizada"],
  recusada_vendedor: [
    "enviada",
    "entregue",
    "visualizada",
    "assinada_proponente",
    "aguardando_vendedor",
  ],
  expirada: ["enviada", "entregue", "visualizada"],
  // `falha_envio` entrou junto com o release da 1ª via no cancelamento de
  // envelope: de lá se chega a proposta que o cliente JÁ viu, e arquivar
  // (cancelar) precisa continuar possível. Espelhado em CANCELLABLE_STATUSES.
  cancelada: [
    "rascunho",
    "aguardando_aprovacao",
    "enviada",
    "entregue",
    "visualizada",
    "assinada_proponente",
    "aguardando_vendedor",
    "falha_envio",
  ],
  falha_envio: ["enviada"],
};

/**
 * Exportado pra o teste de paridade com `TERMINAL_STATUSES` (status-sets.ts) —
 * os dois já divergiram em silêncio antes; agora um teste quebra se divergirem.
 */
export const TERMINAL: readonly ProposalStatus[] = [
  "convertida",
  "recusada_proponente",
  "recusada_vendedor",
  "expirada",
  "cancelada",
  "completa",
];

export type AdvanceResult =
  | { moved: true; from: ProposalStatus; to: ProposalStatus }
  | { moved: false; reason: "replay" } // já estava no destino → no-op ok
  | { moved: false; reason: "illegal"; from: ProposalStatus }; // transição inválida → alerta

/**
 * Avança o status por CAS. Idempotente contra webhook reentregue.
 *
 * `count === 0` tem DUAS causas e elas não podem ser confundidas:
 *  - o status já é o destino → replay (webhook duplicado), no-op legítimo;
 *  - o status é outro que não um predecessor válido → transição ILEGAL, que
 *    precisa virar um `ProposalEvent(status_transition_rejected)` + alerta, não
 *    ser engolida em silêncio (foi o bug do plano v1).
 */
export async function advanceProposalStatus(
  proposalId: string,
  to: ProposalStatus,
  extra?: Prisma.ProposalUpdateManyMutationInput
): Promise<AdvanceResult> {
  const allowedFrom = ALLOWED_FROM[to];
  // Best-effort: lê o status ANTES do CAS pra devolver o `from` REAL (era
  // hardcoded "rascunho", inutilizando o campo pra caller/telemetria). Pode
  // raciar com outro writer — por isso "best-effort": o CAS continua sendo a
  // única autoridade da transição; o pre-read só informa o resultado.
  const pre = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { status: true },
  });
  const preStatus = (pre?.status ?? null) as ProposalStatus | null;
  const res = await prisma.proposal.updateMany({
    where: { id: proposalId, status: { in: [...allowedFrom] } },
    data: { status: to, ...extra },
  });
  if (res.count > 0) {
    return { moved: true, from: preStatus ?? "rascunho", to };
  }

  // Não moveu — descobrir por quê.
  const current = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { status: true },
  });
  const cur = (current?.status ?? "rascunho") as ProposalStatus;
  if (cur === to) return { moved: false, reason: "replay" };

  // Registra a transição ilegal pra diagnóstico — sem derrubar o caller.
  await prisma.proposalEvent
    .create({
      data: {
        proposalId,
        eventName: "status_transition_rejected",
        source: "system",
        payload: { attemptedTo: to, current: cur } as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});
  return { moved: false, reason: "illegal", from: cur };
}

export function isTerminal(status: string): boolean {
  return TERMINAL.includes(status as ProposalStatus);
}
