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
  $executeRaw: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

const { verifyMaxWebhook, parseDeliveryOutcome, applyDeliveryOutcome, rankCaseSql } =
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
  db.$executeRaw.mockResolvedValue(0);
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
  it("um UPDATE atômico por tabela, com merge e guarda de rank no WHERE", async () => {
    db.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const r = await applyDeliveryOutcome(parseDeliveryOutcome(OUTCOME)!);
    expect(r).toEqual({ dealLogs: 1, userDeliveries: 0 });
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);

    // O SQL carrega: match por id (o dedupeKey do payload É o logId — a
    // coluna dedupeKey dos modelos guarda chave de EVENTO), cerca de org,
    // escrita na coluna PRÓPRIA (fora do alcance dos settles) e a guarda de
    // rank — a monotonicidade mora no WHERE, não em check-then-act de app.
    const sql = db.$executeRaw.mock.calls[0][0].join("?");
    expect(sql).toContain('UPDATE "DealNotificationLog"');
    expect(sql).toContain('SET "maxDeliveryJson" = ');
    expect(sql).toContain('"orgId" = ');
    expect(sql).toContain("channel = 'whatsapp'");
    const params = db.$executeRaw.mock.calls[0].slice(1);
    expect(params).toContain("log-abc");
    expect(params).toContain("org-1");
    // rank de read = 3, e a marca serializada viaja como json
    expect(params).toContain(3);
    expect(params.some((x) => typeof x === "string" && x.includes('"status":"read"'))).toBe(true);
  });

  it("o CASE de rank é derivado do mapa — sem cópia sincronizada à mão", () => {
    const sql = rankCaseSql();
    expect(sql).toContain("WHEN 'read' THEN 3");
    expect(sql).toContain("WHEN 'delivered' THEN 2");
    expect(sql).toContain("WHEN 'unconfirmed' THEN 1");
    expect(sql).toContain("WHEN 'failed' THEN 1");
    expect(sql).toContain("ELSE 0");
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
