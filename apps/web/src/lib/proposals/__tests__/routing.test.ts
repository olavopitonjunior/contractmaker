import { describe, it, expect } from "vitest";
import { decideInstrument, interpretWhatsappProbe } from "../routing";

const PLUS = { whatsappSignatureAvailable: true, acceptanceWhatsappAvailable: true };
const NAO_PLUS = { whatsappSignatureAvailable: false, acceptanceWhatsappAvailable: true };
const SEM_NADA = { whatsappSignatureAvailable: false, acceptanceWhatsappAvailable: false };

const wa = (over = {}) => ({ channel: "whatsapp" as const, hasEmail: true, hasPhone: true, ...over });
const em = (over = {}) => ({ channel: "email" as const, hasEmail: true, hasPhone: false, ...over });

describe("decideInstrument — roteamento por capacidade", () => {
  it("conta Plus + WhatsApp → envelope, canal whatsapp mantido", () => {
    const d = decideInstrument({ hiddenCommission: false, signers: [wa(), em()], caps: PLUS });
    expect(d.instrument).toBe("envelope");
    expect(d.resolvedChannels).toEqual(["whatsapp", "email"]);
    expect(d.blocked).toBeUndefined();
  });

  it("não-Plus + todos com telefone → Aceite via WhatsApp, com aviso honesto", () => {
    const d = decideInstrument({ hiddenCommission: false, signers: [wa(), wa()], caps: NAO_PLUS });
    expect(d.instrument).toBe("aceite");
    expect(d.resolvedChannels).toEqual(["whatsapp", "whatsapp"]);
    expect(d.warnings.join(" ")).toMatch(/Aceite via WhatsApp/i);
    expect(d.warnings.join(" ")).toMatch(/upgrade para o Plus/i);
  });

  it("comissão oculta FORÇA envelope, mesmo querendo WhatsApp (não-Plus degrada pra e-mail)", () => {
    const d = decideInstrument({ hiddenCommission: true, signers: [wa()], caps: NAO_PLUS });
    expect(d.instrument).toBe("envelope");
    expect(d.resolvedChannels).toEqual(["email"]);
    expect(d.warnings.join(" ")).toMatch(/plano Plus/i);
  });

  it("não-Plus, Aceite indisponível → degrada pra e-mail", () => {
    const d = decideInstrument({ hiddenCommission: false, signers: [wa()], caps: SEM_NADA });
    expect(d.instrument).toBe("envelope");
    expect(d.resolvedChannels).toEqual(["email"]);
  });

  it("não-Plus + WhatsApp + signatário SEM e-mail e SEM Plus → bloqueia", () => {
    const d = decideInstrument({
      hiddenCommission: true, // força envelope; sem Plus e sem e-mail = beco
      signers: [wa({ hasEmail: false })],
      caps: NAO_PLUS,
    });
    expect(d.blocked).toBeTruthy();
  });

  it("Aceite exige telefone de TODOS — um sem telefone cai pro envelope", () => {
    const d = decideInstrument({
      hiddenCommission: false,
      signers: [wa(), wa({ hasPhone: false })],
      caps: NAO_PLUS,
    });
    expect(d.instrument).toBe("envelope");
  });

  it("só e-mail, ninguém quer WhatsApp → envelope tranquilo", () => {
    const d = decideInstrument({ hiddenCommission: false, signers: [em(), em()], caps: PLUS });
    expect(d.instrument).toBe("envelope");
    expect(d.resolvedChannels).toEqual(["email", "email"]);
    expect(d.warnings).toHaveLength(0);
  });
});

describe("decideInstrument — capacidade NÃO verificada", () => {
  // Cenário real do tenant que motivou o campo: `capabilitiesCheckedAt` null,
  // `whatsappSignatureAvailable` null → o roteamento assumia `false` e mandava
  // tudo por Aceite em silêncio. Agora o desfecho é o mesmo, mas ele AVISA.
  const NAO_VERIFICADO = { ...NAO_PLUS, capabilitiesVerified: false };

  it("Aceite escolhido sem medição → marca capabilitiesUnverified e avisa", () => {
    const d = decideInstrument({
      hiddenCommission: false,
      signers: [wa()],
      caps: NAO_VERIFICADO,
    });
    expect(d.instrument).toBe("aceite");
    expect(d.capabilitiesUnverified).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/nunca foi verificada/i);
  });

  it("degradação WhatsApp→e-mail sem medição também avisa", () => {
    const d = decideInstrument({
      hiddenCommission: true, // força envelope
      signers: [wa()],
      caps: NAO_VERIFICADO,
    });
    expect(d.instrument).toBe("envelope");
    expect(d.capabilitiesUnverified).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/nunca foi verificada/i);
  });

  it("ninguém quer WhatsApp → não avisa (o palpite não mudou nada)", () => {
    const d = decideInstrument({
      hiddenCommission: false,
      signers: [em(), em()],
      caps: NAO_VERIFICADO,
    });
    expect(d.capabilitiesUnverified).toBeUndefined();
    expect(d.warnings).toHaveLength(0);
  });

  it("conta MEDIDA como não-Plus → sem aviso de verificação (é fato, não palpite)", () => {
    const d = decideInstrument({
      hiddenCommission: false,
      signers: [wa()],
      caps: { ...NAO_PLUS, capabilitiesVerified: true },
    });
    expect(d.instrument).toBe("aceite");
    expect(d.capabilitiesUnverified).toBeUndefined();
    expect(d.warnings.join(" ")).not.toMatch(/nunca foi verificada/i);
  });

  it("conta Plus verificada → assina por WhatsApp, nada de Aceite", () => {
    const d = decideInstrument({
      hiddenCommission: false,
      signers: [wa()],
      caps: { ...PLUS, capabilitiesVerified: true },
    });
    expect(d.instrument).toBe("envelope");
    expect(d.resolvedChannels).toEqual(["whatsapp"]);
    expect(d.capabilitiesUnverified).toBeUndefined();
  });

  it("campo omitido = compat: trata como verificado (não polui chamador antigo)", () => {
    const d = decideInstrument({ hiddenCommission: false, signers: [wa()], caps: NAO_PLUS });
    expect(d.capabilitiesUnverified).toBeUndefined();
  });
});

describe("interpretWhatsappProbe — três estados", () => {
  it("2xx → available", () => {
    expect(interpretWhatsappProbe(201, {})).toBe("available");
  });
  it("422 do plano → unavailable (cacheável)", () => {
    const body = { errors: [{ detail: "signature_request - plano não inclui a funcionalidade de envio por whatsapp" }] };
    expect(interpretWhatsappProbe(422, body)).toBe("unavailable");
  });
  it("422 por outro motivo → inconclusive (não cacheia)", () => {
    const body = { errors: [{ detail: "phone_number inválido" }] };
    expect(interpretWhatsappProbe(422, body)).toBe("inconclusive");
  });
  it("erro de rede/500 → inconclusive", () => {
    expect(interpretWhatsappProbe(500, null)).toBe("inconclusive");
  });
});
