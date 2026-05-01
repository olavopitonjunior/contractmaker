import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  parseWebhookEventName,
  verifyWebhookSignature,
  getEnvelopeIdFromPayload,
  getSignerEmailFromPayload,
  getSignedDocumentUrlFromPayload,
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
