import { describe, it, expect } from "vitest";
import { proposalSendChannel } from "../send-channel";

describe("proposalSendChannel", () => {
  it("sem signatário nenhum devolve vazio", () => {
    const v = proposalSendChannel({ instrument: "envelope" });
    expect(v).toEqual({ key: "nenhum", label: "—", resolved: false });
  });

  it("antes do envio usa o canal PEDIDO e marca como não resolvido", () => {
    const v = proposalSendChannel({
      instrument: "envelope",
      plannedSigners: [{ notifyChannel: "whatsapp" }, { notifyChannel: "whatsapp" }],
    });
    expect(v).toMatchObject({ key: "whatsapp", label: "WhatsApp", resolved: false });
  });

  it("o canal do ENVELOPE vence o do plano", () => {
    // É o caso que motiva a precedência: o corretor pediu WhatsApp, mas a conta
    // ClickSign não assina por WhatsApp e `decideInstrument` rebaixou pra e-mail.
    // Mostrar "WhatsApp" aqui afirmaria um canal que ninguém usou.
    const v = proposalSendChannel({
      instrument: "envelope",
      plannedSigners: [{ notifyChannel: "whatsapp" }],
      envelopeSigners: [{ notifyChannel: "email" }],
    });
    expect(v).toMatchObject({ key: "email", label: "E-mail", resolved: true });
  });

  it("aceite é WhatsApp por construção, mesmo com plano em e-mail", () => {
    // O roteamento força TODOS os canais pra whatsapp antes de escolher aceite.
    const v = proposalSendChannel({
      instrument: "aceite",
      plannedSigners: [{ notifyChannel: "email" }],
    });
    expect(v).toMatchObject({ key: "whatsapp", resolved: true });
  });

  it("envelope existente vence até sobre o instrumento aceite", () => {
    const v = proposalSendChannel({
      instrument: "aceite",
      envelopeSigners: [{ notifyChannel: "email" }],
    });
    expect(v).toMatchObject({ key: "email", resolved: true });
  });

  it("canais distintos viram 'misto' com rótulo em ordem estável", () => {
    const a = proposalSendChannel({
      instrument: "envelope",
      envelopeSigners: [{ notifyChannel: "whatsapp" }, { notifyChannel: "email" }],
    });
    const b = proposalSendChannel({
      instrument: "envelope",
      envelopeSigners: [{ notifyChannel: "email" }, { notifyChannel: "whatsapp" }],
    });
    expect(a).toMatchObject({ key: "misto", label: "E-mail e WhatsApp" });
    // A ordem das linhas no banco não pode mudar o rótulo.
    expect(b.label).toBe(a.label);
  });

  it("ignora canal desconhecido/nulo em vez de inventar rótulo", () => {
    const v = proposalSendChannel({
      instrument: "envelope",
      envelopeSigners: [{ notifyChannel: null }, { notifyChannel: "email" }],
    });
    expect(v).toMatchObject({ key: "email", resolved: true });
  });

  it("reconhece sms", () => {
    const v = proposalSendChannel({
      instrument: "envelope",
      envelopeSigners: [{ notifyChannel: "sms" }],
    });
    expect(v).toMatchObject({ key: "sms", label: "SMS" });
  });
});
