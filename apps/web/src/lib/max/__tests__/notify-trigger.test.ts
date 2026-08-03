import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/max/gate", () => ({
  isMaxEnabledForOrg: vi.fn().mockResolvedValue(true),
}));

import { isMaxEnabledForOrg } from "@/lib/max/gate";

const gate = isMaxEnabledForOrg as unknown as ReturnType<typeof vi.fn>;

const SECRET = "s3cr3t";

/**
 * As envs são lidas na carga do módulo, então cada cenário precisa importar de
 * novo depois de mexer nelas.
 */
async function loadTrigger(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
  const mod = await import("../notify-trigger");
  return mod.triggerMaxNotify;
}

function args(over: Record<string, unknown> = {}) {
  return {
    orgId: "org1",
    audience: "platform_user" as const,
    phone: "(11) 98765-4321",
    recipientName: "Marcia",
    title: "Contrato pronto",
    body: "O contrato foi gerado.",
    orgName: "Imob Teste",
    dedupeKey: "log1",
    ...over,
  };
}

function okResponse(body: unknown = { id: "mx1" }) {
  return {
    ok: true,
    status: 202,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("triggerMaxNotify — gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("MAX_DISABLED corta antes de qualquer leitura de módulo", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const trigger = await loadTrigger({
      MAX_DISABLED: "true",
      MAX_NOTIFY_URL: "https://max.test",
      MAX_NOTIFY_SECRET: SECRET,
    });

    expect(await trigger(args())).toEqual({
      status: "skipped",
      reason: "max_disabled",
    });
    expect(gate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("feature desligada na org não manda", async () => {
    gate.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const trigger = await loadTrigger({
      MAX_DISABLED: "false",
      MAX_NOTIFY_URL: "https://max.test",
      MAX_NOTIFY_SECRET: SECRET,
    });

    expect(await trigger(args())).toEqual({
      status: "skipped",
      reason: "max_off_para_a_org",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem envs do serviço não manda (é o estado de staging, por desenho)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const trigger = await loadTrigger({
      MAX_DISABLED: "false",
      MAX_NOTIFY_URL: undefined,
      MAX_NOTIFY_SECRET: undefined,
    });

    expect(await trigger(args())).toEqual({
      status: "skipped",
      reason: "max_service_ausente",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * O motivo fica no log do NEGÓCIO, que é onde alguém procura quando "o
   * corretor não recebeu" — e não perdido num log de servidor.
   */
  it("telefone impossível de normalizar vira skipped com motivo", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const trigger = await loadTrigger({
      MAX_DISABLED: "false",
      MAX_NOTIFY_URL: "https://max.test",
      MAX_NOTIFY_SECRET: SECRET,
    });

    expect(await trigger(args({ phone: "123" }))).toEqual({
      status: "skipped",
      reason: "telefone_invalido",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("triggerMaxNotify — requisição", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function send(over: Record<string, unknown> = {}, res = okResponse()) {
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", fetchMock);
    const trigger = await loadTrigger({
      MAX_DISABLED: "false",
      MAX_NOTIFY_URL: "https://max.test/",
      MAX_NOTIFY_SECRET: SECRET,
    });
    const out = await trigger(args(over));
    return { out, fetchMock };
  }

  it("assina o corpo com HMAC sobre 'timestamp.body' e normaliza o telefone", async () => {
    const { out, fetchMock } = await send();

    expect(out).toEqual({ status: "sent", id: "mx1" });

    const [url, init] = fetchMock.mock.calls[0];
    // A barra final da env não pode virar "//notify".
    expect(url).toBe("https://max.test/notify");

    const ts = init.headers["X-Max-Timestamp"];
    const expected = createHmac("sha256", SECRET)
      .update(`${ts}.${init.body}`)
      .digest("hex");
    expect(init.headers["X-Max-Signature"]).toBe(expected);

    const body = JSON.parse(init.body);
    expect(body.phone).toBe("+5511987654321");
    expect(body.dedupeKey).toBe("log1");
  });

  it("saneia os campos que podem vir de formulário público anônimo", async () => {
    const { fetchMock } = await send({
      recipientName: 'Maria "Teste"\nSouza',
      body: "linha1\nlinha2",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.recipientName).toBe("Maria Teste Souza");
    expect(body.body).toBe("linha1 linha2");
  });

  /**
   * 409 é a idempotência funcionando: o Max já tem esta dedupeKey. Reportar
   * "sent" mantém o log do negócio coerente com o que o destinatário viu —
   * uma mensagem só.
   */
  it("409 do serviço conta como enviado, não como falha", async () => {
    const { out } = await send({}, { ok: false, status: 409 } as Response);
    expect(out).toEqual({ status: "sent", id: null });
  });

  it("erro HTTP vira failed com o status no motivo", async () => {
    const { out } = await send({}, {
      ok: false,
      status: 500,
      text: async () => "boom",
    } as unknown as Response);
    expect(out).toEqual({ status: "failed", error: "HTTP 500: boom" });
  });

  /**
   * Diferença deliberada em relação ao Newton: lá o turn seguia server-side
   * depois do abort, então timeout contava como envio. Um POST abortado aqui
   * pode ter morrido antes de enfileirar — e a dedupeKey torna um reenvio
   * seguro, então a leitura honesta é `failed`.
   */
  it("timeout vira failed (NÃO 'sent', como no Newton)", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { out } = await (async () => {
      const fetchMock = vi.fn().mockRejectedValue(abort);
      vi.stubGlobal("fetch", fetchMock);
      const trigger = await loadTrigger({
        MAX_DISABLED: "false",
        MAX_NOTIFY_URL: "https://max.test",
        MAX_NOTIFY_SECRET: SECRET,
      });
      return { out: await trigger(args()) };
    })();

    expect(out.status).toBe("failed");
    expect((out as { error: string }).error).toContain("timeout");
  });
});
