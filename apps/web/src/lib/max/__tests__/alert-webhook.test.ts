import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

/**
 * O receptor do alerta de canal do Max.
 *
 * O que se protege aqui, em ordem de importância:
 *
 *  1. **E-mail recusado vira 500, não 200.** É o teste que garante o retry do
 *     outro lado: o max-agent só carimba `notified_at` quando o POST devolve
 *     2xx, então um 200 mentiroso perderia o alerta para sempre — e alerta
 *     perdido é exatamente a falha de 04/08 que este trabalho existe para
 *     matar.
 *  2. **Destinatário nunca vira lista vazia.** `MAX_ALERT_EMAIL` ausente cai
 *     nos super_admins do banco.
 *  3. O HMAC e a janela de ±5 min, herdados do webhook vizinho.
 *  4. O conteúdo: o número de represadas TEM que aparecer no corpo — é o que
 *     decide a urgência de quem lê às 3 da manhã.
 */

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/client", () => email);

const alerts = vi.hoisted(() => ({
  alertRecipients: vi.fn(),
  reportPlatformAlert: vi.fn(),
}));
vi.mock("@/lib/alerts/platform-alerts", () => alerts);

const { parseMaxAlert, renderMaxAlert, maxAlertRecipients, formatDuracao } =
  await import("../alert-webhook");
const { POST } = await import("@/app/api/webhooks/max/alert/route");

const SECRET = "segredo-webhook-teste";

function sign(timestamp: string, rawBody: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

const CAIU = {
  evento: "zapi_desconectada",
  at: "2026-08-22T03:14:00.000Z",
  represadas: 4,
};
const VOLTOU = {
  evento: "zapi_reconectada",
  at: "2026-08-22T05:27:00.000Z",
  foraPorMs: 8_003_000,
};

function reqFor(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://cm.test/api/webhooks/max/alert", {
    method: "POST",
    body,
    headers,
  });
}

function assinado(payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const ts = String(Date.now());
  return reqFor(rawBody, {
    "x-max-timestamp": ts,
    "x-max-signature": sign(ts, rawBody),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("MAX_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("MAX_ALERT_EMAIL", "dono@exemplo.com");
  email.sendEmail.mockResolvedValue({ id: "e-1", ok: true });
  alerts.alertRecipients.mockResolvedValue(["super@exemplo.com"]);
});

describe("parseMaxAlert", () => {
  it("aceita os dois eventos do contrato", () => {
    expect(parseMaxAlert(CAIU)).toEqual(CAIU);
    expect(parseMaxAlert(VOLTOU)).toEqual(VOLTOU);
  });

  it("recusa evento desconhecido, campo faltando e represadas negativa", () => {
    expect(parseMaxAlert({ ...CAIU, evento: "zapi_confusa" })).toBeNull();
    expect(parseMaxAlert({ evento: "zapi_desconectada", at: CAIU.at })).toBeNull();
    expect(parseMaxAlert({ ...CAIU, represadas: -1 })).toBeNull();
    expect(parseMaxAlert({ ...CAIU, at: "ontem" })).toBeNull();
  });

  /**
   * Discriminated union: os campos NÃO se misturam. `foraPorMs` numa queda
   * indicaria que um dos lados mudou o contrato pela metade.
   */
  it("recusa campo do outro evento", () => {
    expect(parseMaxAlert({ evento: "zapi_desconectada", at: CAIU.at, foraPorMs: 1 })).toBeNull();
  });
});

describe("formatDuracao", () => {
  it("usa as duas maiores unidades", () => {
    expect(formatDuracao(47_000)).toBe("47s");
    expect(formatDuracao(8 * 60_000)).toBe("8min");
    expect(formatDuracao(8_003_000)).toBe("2h13m");
    expect(formatDuracao(28 * 60 * 60_000)).toBe("1d 4h");
  });
});

describe("renderMaxAlert", () => {
  it("o número de represadas está no assunto E no corpo", () => {
    const { subject, html } = renderMaxAlert(parseMaxAlert(CAIU)!);
    expect(subject).toContain("4 mensagem(ns) represada(s)");
    expect(html).toContain("4 mensagem(ns) represada(s)");
  });

  /** Zero é notícia legítima: a queda derruba o inbound mesmo com fila vazia. */
  it("fila vazia não vira assunto mentiroso", () => {
    const { subject, html } = renderMaxAlert(parseMaxAlert({ ...CAIU, represadas: 0 })!);
    expect(subject).not.toContain("0 mensagem");
    expect(html).toContain("Nenhuma notificação está represada");
  });

  it("a reconexão diz quanto tempo ficou fora", () => {
    const { subject, html } = renderMaxAlert(parseMaxAlert(VOLTOU)!);
    expect(subject).toContain("2h13m");
    expect(html).toContain("2h13m");
  });
});

describe("maxAlertRecipients", () => {
  it("usa MAX_ALERT_EMAIL, aceitando lista", async () => {
    vi.stubEnv("MAX_ALERT_EMAIL", "a@x.com, b@x.com");
    expect(await maxAlertRecipients()).toEqual(["a@x.com", "b@x.com"]);
    expect(alerts.alertRecipients).not.toHaveBeenCalled();
  });

  it("env ausente NÃO vira lista vazia — cai nos super_admins", async () => {
    vi.stubEnv("MAX_ALERT_EMAIL", "");
    expect(await maxAlertRecipients()).toEqual(["super@exemplo.com"]);
  });
});

describe("POST /api/webhooks/max/alert", () => {
  it("sem MAX_WEBHOOK_SECRET responde 503 — receptor inerte", async () => {
    vi.stubEnv("MAX_WEBHOOK_SECRET", "");
    const res = await POST(reqFor(JSON.stringify(CAIU)));
    expect(res.status).toBe(503);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("assinatura inválida responde 401 e não manda e-mail", async () => {
    const rawBody = JSON.stringify(CAIU);
    const ts = String(Date.now());
    const res = await POST(
      reqFor(rawBody, { "x-max-timestamp": ts, "x-max-signature": sign(ts, rawBody, "outro") })
    );
    expect(res.status).toBe(401);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("timestamp fora da janela responde 401", async () => {
    const rawBody = JSON.stringify(CAIU);
    const ts = String(Date.now() - 6 * 60_000);
    const res = await POST(
      reqFor(rawBody, { "x-max-timestamp": ts, "x-max-signature": sign(ts, rawBody) })
    );
    expect(res.status).toBe(401);
  });

  it("corpo inválido responde 400 depois de autenticar", async () => {
    const res = await POST(assinado({ evento: "zapi_confusa" }));
    expect(res.status).toBe(400);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("alerta válido manda o e-mail e responde 200", async () => {
    const res = await POST(assinado(CAIU));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const arg = email.sendEmail.mock.calls[0][0];
    expect(arg.to).toEqual(["dono@exemplo.com"]);
    expect(arg.subject).toContain("desconectado");
    expect(arg.html).toContain("4 mensagem(ns) represada(s)");
  });

  /**
   * O registro é `notify: "digest"` de propósito: o e-mail já saiu por fora, e
   * o re-arm de 24h do motor de alertas engoliria um segundo incidente no
   * mesmo dia. Registro e notificação por caminhos separados.
   */
  it("registra em PlatformAlertEvent sem e-mailar de novo", async () => {
    await POST(assinado(CAIU));
    expect(alerts.reportPlatformAlert).toHaveBeenCalledTimes(1);
    const arg = alerts.reportPlatformAlert.mock.calls[0][0];
    expect(arg.kind).toBe("agent_channel_down");
    expect(arg.notify).toBe("digest");
    expect(arg.severity).toBe("critical");
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  /**
   * O TESTE QUE SUSTENTA O RETRY. `sendEmail` não lança — devolve `ok:false`.
   * Um 200 aqui faria o max-agent carimbar `notified_at` e o alerta sumiria.
   */
  it("e-mail recusado pelo provedor vira 500, não 200", async () => {
    email.sendEmail.mockResolvedValue({ id: null, ok: false, error: "smtp fora" });
    const res = await POST(assinado(CAIU));
    expect(res.status).toBe(500);
  });

  it("sem destinatário nenhum também vira 500", async () => {
    vi.stubEnv("MAX_ALERT_EMAIL", "");
    alerts.alertRecipients.mockResolvedValue([]);
    const res = await POST(assinado(CAIU));
    expect(res.status).toBe(500);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("a reconexão também é entregue", async () => {
    const res = await POST(assinado(VOLTOU));
    expect(res.status).toBe(200);
    expect(email.sendEmail.mock.calls[0][0].subject).toContain("reconectado");
    expect(alerts.reportPlatformAlert.mock.calls[0][0].severity).toBe("info");
  });
});
