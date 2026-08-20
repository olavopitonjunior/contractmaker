// Server-only por CONVENÇÃO (devolve Prisma.ProposalWhereInput) — molde de
// live-vendedor-via.ts: predicado único em módulo próprio, importado pelo
// list-filters.server.ts.
import type { Prisma } from "@prisma/client";

/**
 * Where de "esta `falha_envio` é um ENVIO CANCELADO" — o equivalente Prisma da
 * pergunta do RÓTULO (`lastSendOutcomeIsCancel`, status-sets.ts), que é a que o
 * badge âmbar responde. NÃO é a pergunta da exclusão: `sentAt` aqui seria o
 * predicado ERRADO — ele é monotônico, então `cancelar → reenviar → o reenvio
 * falha de verdade` tem `sentAt` preenchido e badge VERMELHO; um chip por
 * `sentAt` mostraria essa falha real sob "Envio cancelado".
 *
 * O badge lê "o ÚLTIMO evento de SEND_OUTCOME_EVENTS é primeira_via_canceled".
 * Prisma não expressa "último evento é X" declarativamente, então esta é a
 * aproximação CONSERVADORA: existe cancelamento E não existe falha. Sob o
 * invariante de CAS (os dois desfechos não coexistem para a mesma proposta),
 * ela é exata. Se um dia coexistirem (ex.: falhou → reenviou → cancelou), o
 * único erro possível é o chip OMITIR essa proposta — nunca incluir uma falha
 * real. Errar por omissão é o lado certo; não "conserte" trocando por sentAt.
 */
export function sendCanceledWhere(): Prisma.ProposalWhereInput {
  return {
    events: { some: { eventName: "primeira_via_canceled" } },
    NOT: { events: { some: { eventName: "send_failed" } } },
  };
}

/**
 * A NEGAÇÃO EXATA de `sendCanceledWhere`, escrita à mão por De Morgan:
 * ¬(existe cancel ∧ não existe falha) = não existe cancel ∨ existe falha.
 *
 * Existe em vez de `NOT: sendCanceledWhere()` porque a semântica do `NOT` do
 * Prisma sobre um objeto COMPOSTO (duas chaves, uma delas outro NOT) não é
 * afirmada pela documentação — se fosse "nega cada campo" em vez de "nega a
 * conjunção", a partição quebraria calada: a falha_envio SEM NENHUM evento de
 * desfecho (falha anterior ao rastro `send_failed`) sumiria dos DOIS chips.
 * De Morgan explícito não depende de semântica de framework, e o teste de
 * paridade prova o XOR contra `sendCanceledWhere` em todos os históricos.
 */
export function notSendCanceledWhere(): Prisma.ProposalWhereInput {
  return {
    OR: [
      { events: { none: { eventName: "primeira_via_canceled" } } },
      { events: { some: { eventName: "send_failed" } } },
    ],
  };
}
