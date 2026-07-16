import { describe, it, expect } from "vitest";
import { computeEventDedupeKey } from "../webhook-process";
import type { WebhookPayload } from "@/lib/clicksign/types";

function payload(over: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event: {
      name: "close",
      occurred_at: "2026-07-15T12:00:00Z",
      data: { signer: { key: "sig-1", email: "a@b.com" } },
    },
    document: { key: "doc-1" },
    ...over,
  } as WebhookPayload;
}

describe("computeEventDedupeKey", () => {
  it("mesmo evento reentregue → mesma chave (barra reprocessamento)", () => {
    const a = computeEventDedupeKey("env-1", payload());
    const b = computeEventDedupeKey("env-1", payload());
    expect(a).toBe(b);
  });

  it("evento diferente (outro occurred_at) → chave diferente", () => {
    const a = computeEventDedupeKey("env-1", payload());
    const b = computeEventDedupeKey(
      "env-1",
      payload({
        event: {
          name: "close",
          occurred_at: "2026-07-15T13:00:00Z",
          data: { signer: { key: "sig-1" } },
        },
      } as Partial<WebhookPayload>)
    );
    expect(a).not.toBe(b);
  });

  it("envelopes diferentes → chaves diferentes", () => {
    expect(computeEventDedupeKey("env-1", payload())).not.toBe(
      computeEventDedupeKey("env-2", payload())
    );
  });

  it("eventos de signatários diferentes no mesmo envelope → chaves diferentes", () => {
    const a = computeEventDedupeKey("env-1", payload());
    const b = computeEventDedupeKey(
      "env-1",
      payload({
        event: {
          name: "sign",
          occurred_at: "2026-07-15T12:00:00Z",
          data: { signer: { key: "sig-2" } },
        },
      } as Partial<WebhookPayload>)
    );
    expect(a).not.toBe(b);
  });
});
