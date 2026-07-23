import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  parseWebhookEventName,
  verifyWebhookSignature,
  getEnvelopeIdFromPayload,
  getSignerEmailFromPayload,
  getSignedDocumentUrlFromPayload,
  getAcceptanceEventFromPayload,
} from "../webhook";

describe("verifyWebhookSignature", () => {
  const secret = "supersecret";
  const body = JSON.stringify({ event: { name: "sign" } });
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  it("aceita assinatura válida (formato hex puro)", () => {
    expect(verifyWebhookSignature(body, expected, secret)).toBe(true);
  });

  it("aceita assinatura no formato 'sha256=...'", () => {
    expect(verifyWebhookSignature(body, `sha256=${expected}`, secret)).toBe(
      true
    );
  });

  it("rejeita assinatura inválida", () => {
    expect(verifyWebhookSignature(body, "deadbeef", secret)).toBe(false);
  });

  it("rejeita header ausente", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });
});

describe("parseWebhookEventName", () => {
  it("retorna nome conhecido", () => {
    expect(
      parseWebhookEventName({ event: { name: "sign" } } as never)
    ).toBe("sign");
  });

  it("retorna null pra evento desconhecido", () => {
    expect(
      parseWebhookEventName({ event: { name: "weird_event" } } as never)
    ).toBe(null);
  });
});

describe("getEnvelopeIdFromPayload", () => {
  it("extrai do envelope direto", () => {
    expect(
      getEnvelopeIdFromPayload({
        event: { name: "sign" },
        envelope: { id: "env-123" },
      } as never)
    ).toBe("env-123");
  });

  it("extrai de event.data.envelope_id", () => {
    expect(
      getEnvelopeIdFromPayload({
        event: { name: "sign", data: { envelope_id: "env-456" } },
      } as never)
    ).toBe("env-456");
  });
});

describe("getSignerEmailFromPayload", () => {
  it("extrai de event.data.signer.email", () => {
    expect(
      getSignerEmailFromPayload({
        event: { name: "sign", data: { signer: { email: "foo@bar.com" } } },
      } as never)
    ).toBe("foo@bar.com");
  });

  it("usa signers[0].email quando há apenas um", () => {
    expect(
      getSignerEmailFromPayload({
        event: { name: "sign" },
        signers: [{ email: "single@x.com" }],
      } as never)
    ).toBe("single@x.com");
  });
});

describe("getSignedDocumentUrlFromPayload", () => {
  it("extrai signed_file_url", () => {
    expect(
      getSignedDocumentUrlFromPayload({
        event: { name: "close" },
        document: { downloads: { signed_file_url: "https://x/y.pdf" } },
      } as never)
    ).toBe("https://x/y.pdf");
  });
});

describe("getAcceptanceEventFromPayload", () => {
  it("evento de envelope (sign) → null (segue fluxo de envelope)", () => {
    expect(
      getAcceptanceEventFromPayload({ event: { name: "sign" } } as never)
    ).toBeNull();
  });

  it("acceptance_term_completed com id em event.data.acceptance_term.id", () => {
    const r = getAcceptanceEventFromPayload({
      event: {
        name: "acceptance_term_completed",
        data: { acceptance_term: { id: "acc_123" } },
      },
    } as never);
    expect(r).toEqual({ acceptanceId: "acc_123", phase: "completed" });
  });

  it("acceptance_term_sent com id top-level acceptance_term.key", () => {
    const r = getAcceptanceEventFromPayload({
      event: { name: "acceptance_term_sent" },
      acceptance_term: { key: "acc_key_9" },
    } as never);
    expect(r).toEqual({ acceptanceId: "acc_key_9", phase: "sent" });
  });

  it("acceptance sem id resolvível → null (não trata sem âncora)", () => {
    expect(
      getAcceptanceEventFromPayload({
        event: { name: "acceptance_term_completed" },
      } as never)
    ).toBeNull();
  });

  // Regressão do bug de produção (2026-07): o payload REAL da ClickSign traz o
  // termo em `acceptance.key` no topo (não em event.data.acceptance_term). Sem
  // essa entrada o id saía null, o Aceite caía no lookup de envelope
  // (unknownEnvelope) e o aceite do proponente NUNCA avançava o status.
  it("shape REAL da ClickSign: acceptance.key no topo + event.name", () => {
    const r = getAcceptanceEventFromPayload({
      event: { name: "acceptance_term_completed", data: { user: {}, account: {} } },
      acceptance: { key: "ccd2a8d3-ce6f-4ff0-9d54-ee69d68da433", status: "completed" },
    } as never);
    expect(r).toEqual({
      acceptanceId: "ccd2a8d3-ce6f-4ff0-9d54-ee69d68da433",
      phase: "completed",
    });
  });
});
