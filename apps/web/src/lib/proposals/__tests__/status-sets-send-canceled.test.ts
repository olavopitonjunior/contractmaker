import { describe, it, expect } from "vitest";
import {
  isFalhaEnvioAlreadyDelivered,
  lastSendOutcomeIsCancel,
  SEND_OUTCOME_EVENTS,
  DELETABLE_STATUSES,
} from "../status-sets";

describe("isFalhaEnvioAlreadyDelivered — pergunta da EXCLUSÃO", () => {
  it("falha_envio SEM sentAt = o envio nunca saiu", () => {
    expect(isFalhaEnvioAlreadyDelivered({ status: "falha_envio", sentAt: null })).toBe(false);
  });

  it("falha_envio COM sentAt = saiu e foi cancelado", () => {
    expect(isFalhaEnvioAlreadyDelivered({ status: "falha_envio", sentAt: new Date() })).toBe(true);
    expect(
      isFalhaEnvioAlreadyDelivered({ status: "falha_envio", sentAt: "2026-08-19T12:00:00Z" })
    ).toBe(true);
  });

  it("sentAt sozinho não basta — qualquer outro status é false", () => {
    // Proposta enviada TEM sentAt; o predicado não pode transformá-la em
    // "cancelada" só por isso. O par status+sentAt é que decide.
    for (const status of ["rascunho", "enviada", "entregue", "visualizada", "cancelada", "completa"]) {
      expect(isFalhaEnvioAlreadyDelivered({ status, sentAt: new Date() }), status).toBe(false);
    }
  });

  it("`falha_envio` continua em DELETABLE_STATUSES — o predicado é que recorta", () => {
    // A exclusão do envio-que-nunca-saiu tem de continuar existindo: é o
    // desfecho natural de uma proposta que ninguém viu. O predicado remove só
    // a subpopulação que circulou, sem tirar o status do conjunto.
    expect(DELETABLE_STATUSES.has("falha_envio")).toBe(true);
  });
});

describe("paridade servidor ↔ UI", () => {
  // O guard do DELETE (api/proposals/[id]/route.ts) e os dois botões Excluir
  // (ProposalRowActions, ProposalActionBar) consomem ESTE predicado. Este teste
  // amarra a regra em si; se alguém reescrever o `if` em qualquer uma das três
  // superfícies em vez de chamar a função, a divergência volta.
  const casos: Array<[string, Date | string | null, boolean]> = [
    ["falha_envio", null, false],
    ["falha_envio", new Date("2026-08-19T12:00:00Z"), true],
    ["rascunho", null, false],
    ["cancelada", new Date(), false],
  ];

  it.each(casos)("status=%s sentAt=%s → bloqueia exclusão: %s", (status, sentAt, esperado) => {
    const bloqueia = isFalhaEnvioAlreadyDelivered({ status, sentAt });
    expect(bloqueia).toBe(esperado);
    // A UI é a negação exata: DELETABLE ∧ ¬predicado.
    const uiOferece = DELETABLE_STATUSES.has(status) && !bloqueia;
    if (esperado) expect(uiOferece).toBe(false);
  });
});

describe("lastSendOutcomeIsCancel — pergunta do RÓTULO (outra que a da exclusão)", () => {
  it("cancelamento → true; falha e ausência de desfecho → false", () => {
    expect(lastSendOutcomeIsCancel("primeira_via_canceled")).toBe(true);
    expect(lastSendOutcomeIsCancel("send_failed")).toBe(false);
    expect(lastSendOutcomeIsCancel(null)).toBe(false);
  });

  it("`null` cai em FALHA — o padrão conservador, e sem backfill", () => {
    // Cancelamento sempre gravou `primeira_via_canceled`; falha nunca gravou
    // nada até `send_failed` existir. Então o acervo já classifica certo.
    expect(lastSendOutcomeIsCancel(null)).toBe(false);
  });

  it("evento irrelevante não é lido como cancelamento", () => {
    for (const ev of ["assignee_changed", "manual_sync", "reminder_sent", "sent"]) {
      expect(lastSendOutcomeIsCancel(ev), ev).toBe(false);
    }
  });

  it("SEND_OUTCOME_EVENTS cobre os dois desfechos e nada além", () => {
    // O filtro da query depende deste conjunto: um desfecho fora dele nunca
    // seria lido, e um evento a mais dentro dele deslocaria a resposta.
    expect([...SEND_OUTCOME_EVENTS].sort()).toEqual(["primeira_via_canceled", "send_failed"]);
  });
});

describe("as duas perguntas são INDEPENDENTES", () => {
  // Foi confundi-las que produziu o bug: `sentAt` é monotônico, então responde
  // "já circulou?" e nunca "por que caiu agora?".
  it("reenvio que falha: circulou (não exclui) mas NÃO é cancelamento", () => {
    const proposta = { status: "falha_envio", sentAt: new Date("2026-08-19T10:00:00Z") };
    expect(isFalhaEnvioAlreadyDelivered(proposta)).toBe(true); // segue protegida
    expect(lastSendOutcomeIsCancel("send_failed")).toBe(false); // mas é falha real
  });

  it("primeira falha, nunca circulou: exclui e é falha", () => {
    expect(isFalhaEnvioAlreadyDelivered({ status: "falha_envio", sentAt: null })).toBe(false);
    expect(lastSendOutcomeIsCancel("send_failed")).toBe(false);
  });
});
