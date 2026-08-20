import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

/**
 * O webhook de desfecho de entrega do Max — a volta do laço do `/notify`.
 *
 * O que se protege: o HMAC (formato idêntico ao do `/notify`, secret próprio),
 * o `orgId` obrigatório na costura (um `dedupeKey` sem org poderia casar linha
 * de outro tenant), a monotonicidade (`read` não regride para `delivered` na
 * reentrega) e o MERGE do `detail` (a marca não pode apagar o que o trilho
 * gravou).
 */

const db = vi.hoisted(() => ({
  dealNotificationLog: { findMany: vi.fn(), update: vi.fn() },
  userNotificationDelivery: { findMany: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

const { verifyMaxWebhook, parseDeliveryOutcome, applyDeliveryOutcome } =
  await import("../delivery-webhook");
const { POST } = await import("@/app/api/webhooks/max/route");

const SECRET = "segredo-webhook-teste";

function sign(timestamp: string, rawBody: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

const OUTCOME = {
  orgId: "org-1",
  dedupeKey: "log-abc",
  status: "read",
  at: "2026-08-20T15:00:00.000Z",
  providerMessageId: "PROV-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("MAX_WEBHOOK_SECRET", SECRET);
  db.dealNotificationLog.findMany.mockResolvedValue([]);
  db.userNotificationDelivery.findMany.mockResolvedValue([]);
});

describe("verifyMaxWebhook", () => {
  const rawBody = JSON.stringify(OUTCOME);

  it("aceita assinatura válida dentro da janela", () => {
    const ts = String(Date.now());
    expect(
      verifyMaxWebhook({ timestamp: ts, signature: sign(ts, rawBody), rawBody, secret: SECRET })
    ).toBe(true);
  });

  it("recusa timestamp fora da janela — futuro inclusive", () => {
    for (const ts of [String(Date.now() - 6 * 60_000), String(Date.now() + 6 * 60_000)]) {
      expect(
        verifyMaxWebhook({ timestamp: ts, signature: sign(ts, rawBody), rawBody, secret: SECRET })
      ).toBe(false);
    }
  });

  it("recusa assinatura de outro corpo e headers ausentes", () => {
    const ts = String(Date.now());
    expect(
      verifyMaxWebhook({ timestamp: ts, signature: sign(ts, "{}"), rawBody, secret: SECRET })
    ).toBe(false);
    expect(
      verifyMaxWebhook({ timestamp: null, signature: null, rawBody, secret: SECRET })
    ).toBe(false);
  });

  /**
   * Vetor fixo, como no hmac-parity: trava `hex(hmac(secret, ts.corpo))`.
   * O outro lado é `max-agent/src/lib/cm.ts::reportDeliveryOutcome`, que
   * assina com o MESMO `sign` do `/notify` — mudou o formato lá, quebra aqui.
   */
  it("vetor fixo de paridade com o reportDeliveryOutcome do max-agent", () => {
    expect(sign("1800000000000", '{"orgId":"org-1","dedupeKey":"log-1"}', "segredo-de-teste-do-vetor")).toBe(
      "1d46081c8a0cb08b6ec1866fbb142ccd17ed6e47f442547d6362113268f75fb8"
    );
  });
});

describe("parseDeliveryOutcome", () => {
  it("exige orgId — dedupeKey sozinho poderia casar linha de outro tenant", () => {
    const { orgId: _drop, ...semOrg } = OUTCOME;
    expect(parseDeliveryOutcome(semOrg)).toBeNull();
    expect(parseDeliveryOutcome(OUTCOME)).toMatchObject({ orgId: "org-1" });
  });

  it("recusa status fora do vocabulário (sent puro não é reportado)", () => {
    expect(parseDeliveryOutcome({ ...OUTCOME, status: "sent" })).toBeNull();
  });
});

describe("applyDeliveryOutcome", () => {
  it("escopa por orgId+dedupeKey+whatsapp e faz MERGE do detail", async () => {
    db.dealNotificationLog.findMany.mockResolvedValue([
      { id: "d1", detail: { skipReason: "ja-existente" } },
    ]);

    const r = await applyDeliveryOutcome(parseDeliveryOutcome(OUTCOME)!);
    expect(r.dealLogs).toBe(1);

    expect(db.dealNotificationLog.findMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", dedupeKey: "log-abc", channel: "whatsapp" },
    });
    const data = db.dealNotificationLog.update.mock.calls[0][0].data;
    // O que o trilho gravou sobrevive; a marca entra ao lado.
    expect(data.detail.skipReason).toBe("ja-existente");
    expect(data.detail.maxDelivery).toMatchObject({ status: "read", at: OUTCOME.at });
  });

  it("é monotônico e idempotente: read existente não regride nem regrava", async () => {
    db.userNotificationDelivery.findMany.mockResolvedValue([
      { id: "u1", detail: { maxDelivery: { status: "read", at: "x" } } },
    ]);

    const delivered = await applyDeliveryOutcome(
      parseDeliveryOutcome({ ...OUTCOME, status: "delivered" })!
    );
    expect(delivered.userDeliveries).toBe(0);
    expect(db.userNotificationDelivery.update).not.toHaveBeenCalled();

    // Upgrade de verdade passa: delivered gravado → read chega.
    db.userNotificationDelivery.findMany.mockResolvedValue([
      { id: "u1", detail: { maxDelivery: { status: "delivered", at: "x" } } },
    ]);
    const read = await applyDeliveryOutcome(parseDeliveryOutcome(OUTCOME)!);
    expect(read.userDeliveries).toBe(1);
  });

  it("unconfirmed é notícia fraca: delivered atrasado a corrige", async () => {
    db.dealNotificationLog.findMany.mockResolvedValue([
      { id: "d1", detail: { maxDelivery: { status: "unconfirmed", at: "x" } } },
    ]);
    const r = await applyDeliveryOutcome(
      parseDeliveryOutcome({ ...OUTCOME, status: "delivered" })!
    );
    expect(r.dealLogs).toBe(1);
  });
});

describe("POST /api/webhooks/max", () => {
  function reqFor(body: string, headers: Record<string, string> = {}) {
    return new NextRequest("http://cm.test/api/webhooks/max", {
      method: "POST",
      body,
      headers,
    });
  }

  it("sem MAX_WEBHOOK_SECRET responde 503 — integração desligada, o Max retenta", async () => {
    vi.stubEnv("MAX_WEBHOOK_SECRET", "");
    expect((await POST(reqFor("{}"))).status).toBe(503);
  });

  it("assinatura inválida é 401 sem detalhe", async () => {
    const res = await POST(reqFor(JSON.stringify(OUTCOME)));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("assinado e válido aplica e responde 200 com as contagens", async () => {
    const rawBody = JSON.stringify(OUTCOME);
    const ts = String(Date.now());
    const res = await POST(
      reqFor(rawBody, { "x-max-timestamp": ts, "x-max-signature": sign(ts, rawBody) })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: { dealLogs: 0, userDeliveries: 0 } });
  });

  it("dedupeKey desconhecida ainda é 200 — sem retentativa eterna do outro lado", async () => {
    const rawBody = JSON.stringify({ ...OUTCOME, dedupeKey: "nao-existe" });
    const ts = String(Date.now());
    const res = await POST(
      reqFor(rawBody, { "x-max-timestamp": ts, "x-max-signature": sign(ts, rawBody) })
    );
    expect(res.status).toBe(200);
  });
});
