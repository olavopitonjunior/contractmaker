/**
 * Por onde a proposta foi (ou vai) para assinatura — WhatsApp ou e-mail.
 *
 * Existem TRÊS fontes para essa informação e elas discordam de propósito:
 *
 *  1. `ProposalSigner.notifyChannel` — o canal PEDIDO pelo corretor no formulário.
 *  2. `Proposal.instrument` — "aceite" (Aceite via WhatsApp) ou "envelope".
 *  3. `EnvelopeSigner.notifyChannel` — o canal REALMENTE usado.
 *
 * A (3) manda quando existe, porque `decideInstrument` (routing.ts) rebaixa
 * WhatsApp→e-mail conforme a capacidade da conta ClickSign: uma proposta pedida
 * em WhatsApp por uma conta sem assinatura por WhatsApp sai por e-mail. Mostrar
 * o pedido em vez do executado faria a lista afirmar um canal que ninguém usou.
 *
 * Puro e client-safe (sem prisma) — mas o resultado é resolvido no SERVIDOR e
 * mandado pronto pro client component, como o resto da lista de propostas.
 */

/** Canal único e concreto — o que uma linha de signatário pode ter. */
export type ConcreteChannel = "email" | "whatsapp" | "sms";

export type SendChannelKey = ConcreteChannel | "misto" | "nenhum";

export interface SendChannelView {
  key: SendChannelKey;
  /** Rótulo curto pra célula da tabela. */
  label: string;
  /** `false` enquanto é só o plano (nada enviado ainda) — a UI esmaece. */
  resolved: boolean;
}

const LABELS: Record<ConcreteChannel, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

/** Ordem fixa do rótulo composto — sem isso "E-mail e WhatsApp" viraria
 *  "WhatsApp e E-mail" conforme a ordem das linhas voltasse do banco. */
const CHANNEL_ORDER: ConcreteChannel[] = ["email", "whatsapp", "sms"];

function normalize(channel: string | null | undefined): ConcreteChannel | null {
  if (channel === "whatsapp") return "whatsapp";
  if (channel === "sms") return "sms";
  if (channel === "email") return "email";
  return null;
}

/** Reduz um conjunto de canais a uma única visão. */
function fromChannels(channels: string[], resolved: boolean): SendChannelView | null {
  const distinct = new Set<ConcreteChannel>();
  for (const c of channels) {
    const k = normalize(c);
    if (k) distinct.add(k);
  }
  if (distinct.size === 0) return null;
  if (distinct.size > 1) {
    const parts = CHANNEL_ORDER.filter((k) => distinct.has(k)).map((k) => LABELS[k]);
    return { key: "misto", label: parts.join(" e "), resolved };
  }
  const only = CHANNEL_ORDER.find((k) => distinct.has(k)) as ConcreteChannel;
  return { key: only, label: LABELS[only], resolved };
}

export function proposalSendChannel(input: {
  instrument: string;
  /** Signatários dos envelopes da proposta (canal executado). */
  envelopeSigners?: { notifyChannel: string | null }[];
  /** Linhas de plano da proposta (canal pedido). */
  plannedSigners?: { notifyChannel: string | null }[];
}): SendChannelView {
  // 1. Executado — envelope já criado.
  const fromEnvelope = fromChannels(
    (input.envelopeSigners ?? []).map((s) => s.notifyChannel ?? ""),
    true
  );
  if (fromEnvelope) return fromEnvelope;

  // 2. Aceite não cria Envelope nenhum, e o roteamento força TODOS os canais pra
  //    whatsapp antes de escolher esse instrumento — então é WhatsApp por
  //    construção, não por inferência.
  if (input.instrument === "aceite") {
    return { key: "whatsapp", label: LABELS.whatsapp, resolved: true };
  }

  // 3. Plano — ainda não enviada.
  const planned = fromChannels(
    (input.plannedSigners ?? []).map((s) => s.notifyChannel ?? ""),
    false
  );
  return planned ?? { key: "nenhum", label: "—", resolved: false };
}
