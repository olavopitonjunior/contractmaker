/**
 * Roteamento do WhatsApp por capacidade da conta ClickSign do tenant.
 *
 * O corretor escolhe o canal por signatário (e-mail / WhatsApp). O SISTEMA
 * decide COMO entregar o WhatsApp, pela capacidade da conta conectada:
 *   - conta Plus+ (whatsappSignatureAvailable)  → assinatura no documento
 *     (envelope + communicate_events whatsapp);
 *   - senão, com Aceite disponível              → Aceite via WhatsApp (R$0,99);
 *   - senão                                     → degrada pra e-mail + avisa.
 *
 * Aceite e envelope são mecanismos DISTINTOS — não se misturam num envelope.
 * A escolha do instrumento é por PROPOSTA.
 */

export type Channel = "email" | "whatsapp";
export type Instrument = "envelope" | "aceite";

export interface RoutingSigner {
  /** Canal que o corretor marcou pra este signatário. */
  channel: Channel;
  hasEmail: boolean;
  hasPhone: boolean;
}

export interface AccountCapabilities {
  whatsappSignatureAvailable: boolean; // plano Plus+
  acceptanceWhatsappAvailable: boolean;
}

export interface RoutingDecision {
  instrument: Instrument;
  /** Canal efetivo por signatário (índice = ordem de entrada). Só relevante no
   *  instrumento "envelope"; no "aceite" todos vão por WhatsApp. */
  resolvedChannels: Channel[];
  /** Mensagens honestas pra UI (ex.: "vai por Aceite, não assinatura"). */
  warnings: string[];
  /** Conflito duro que impede o envio (ex.: signatário sem e-mail nem telefone
   *  utilizável). Quando presente, a UI bloqueia. */
  blocked?: string;
}

/**
 * Decide o instrumento e os canais efetivos.
 *
 * `hiddenCommission` (duas vias) FORÇA envelope — o Aceite não suporta ocultação.
 */
export function decideInstrument(input: {
  hiddenCommission: boolean;
  signers: RoutingSigner[];
  caps: AccountCapabilities;
}): RoutingDecision {
  const { hiddenCommission, signers, caps } = input;
  const wantsWhatsapp = signers.some((s) => s.channel === "whatsapp");
  const warnings: string[] = [];

  // Caminho ACEITE: só quando (a) alguém quer WhatsApp, (b) a conta NÃO é Plus,
  // (c) o Aceite está disponível, (d) NÃO há comissão oculta, e (e) todos os
  // signatários têm telefone (o Aceite é WhatsApp-only).
  const aceiteViable =
    wantsWhatsapp &&
    !caps.whatsappSignatureAvailable &&
    caps.acceptanceWhatsappAvailable &&
    !hiddenCommission &&
    signers.every((s) => s.hasPhone);

  if (aceiteViable) {
    warnings.push(
      "Plano atual: envio por Aceite via WhatsApp (R$ 0,99) — o cliente confirma por texto + link. Para assinatura no documento por WhatsApp, faça upgrade para o Plus."
    );
    return {
      instrument: "aceite",
      resolvedChannels: signers.map(() => "whatsapp"),
      warnings,
    };
  }

  // Caminho ENVELOPE (default). Resolve o canal de cada signatário.
  const resolvedChannels: Channel[] = [];
  let blocked: string | undefined;

  signers.forEach((s, i) => {
    if (s.channel === "whatsapp") {
      if (caps.whatsappSignatureAvailable && s.hasPhone) {
        resolvedChannels[i] = "whatsapp";
        return;
      }
      // Quer WhatsApp mas a conta não assina por WhatsApp (ou falta telefone) →
      // degrada pra e-mail.
      if (s.hasEmail) {
        resolvedChannels[i] = "email";
        if (!caps.whatsappSignatureAvailable) {
          warnings.push(
            `Signatário ${i + 1}: a conta não tem assinatura por WhatsApp (plano Plus). Enviado por e-mail.`
          );
        } else {
          warnings.push(`Signatário ${i + 1}: sem telefone válido — enviado por e-mail.`);
        }
        return;
      }
      // Sem WhatsApp viável e sem e-mail → não há como notificar.
      blocked =
        blocked ??
        `Signatário ${i + 1}: quer WhatsApp mas a conta não assina por WhatsApp e ele não tem e-mail. Adicione um e-mail ou conecte uma conta Plus.`;
      resolvedChannels[i] = "email";
      return;
    }
    // Canal e-mail.
    if (!s.hasEmail) {
      blocked = blocked ?? `Signatário ${i + 1}: canal e-mail sem endereço de e-mail.`;
    }
    resolvedChannels[i] = "email";
  });

  return { instrument: "envelope", resolvedChannels, warnings, blocked };
}

export type ProbeVerdict = "available" | "unavailable" | "inconclusive";

/**
 * Interpreta o resultado do probe de assinatura por WhatsApp (o mesmo do spike:
 * criar signer com communicate_events whatsapp num rascunho).
 *
 * - 2xx → `available`.
 * - 422 mencionando "plano não inclui ... whatsapp" → `unavailable` (definitivo,
 *   pode cachear). Foi o erro exato observado no spike.
 * - qualquer outra falha → `inconclusive` (ex.: telefone ruim, rede) → NÃO
 *   cachear como indisponível; o caller mantém o valor anterior/null.
 */
export function interpretWhatsappProbe(
  status: number,
  body: unknown
): ProbeVerdict {
  if (status >= 200 && status < 300) return "available";
  const text = JSON.stringify(body ?? "").toLowerCase();
  if (
    status === 422 &&
    text.includes("whatsapp") &&
    (text.includes("plano não inclui") || text.includes("plano nao inclui"))
  ) {
    return "unavailable";
  }
  return "inconclusive";
}
