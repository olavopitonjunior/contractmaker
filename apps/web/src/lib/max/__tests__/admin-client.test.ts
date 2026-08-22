import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

/**
 * O cliente do painel do Max.
 *
 * O que este arquivo defende é a assinatura — e ela mudou por um motivo de
 * segurança, não de estilo.
 *
 * O `fetchMaxStatus` assinava `${timestamp}.` (corpo vazio, porque GET não tem
 * corpo), o que deixava a QUERY de fora: uma assinatura capturada valia cinco
 * minutos para **qualquer `?orgId=`**, e o painel de um tenant abria o de
 * outro. O serviço já aceita o formato que cobre a query e mantinha o antigo
 * só esperando este cliente migrar.
 *
 * Um teste de "chamou a URL certa" não pegaria uma regressão aqui: o formato
 * errado também chama a URL certa. O que precisa ser fixado é **o que entra no
 * HMAC** — daí a conferência byte a byte contra o valor recomputado.
 */

const SECRET = "segredo-de-teste";
const BASE = "https://max.test";

function payloadAssinado(url: string, timestamp: string) {
  const u = new URL(url);
  return `${timestamp}.GET.${u.pathname}${u.search}`;
}

describe("admin-client do Max", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MAX_NOTIFY_URL", BASE);
    vi.stubEnv("MAX_NOTIFY_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Captura a chamada sem bater na rede. */
  function espiar(body: unknown, status = 200) {
    const chamadas: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        chamadas.push({
          url: url.toString(),
          headers: init.headers as Record<string, string>,
        });
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
        } as Response;
      })
    );
    return chamadas;
  }

  /**
   * A URL exata, e não só "contém orgId".
   *
   * Os outros testes recomputam a assinatura A PARTIR da URL capturada — isso
   * prova que o que foi chamado foi assinado direito, e **não** prova que a URL
   * está certa. Um erro de caminho, de ordem de parâmetro ou um `limit`
   * esquecido passaria batido, e a ordem importa: o vetor fixo de paridade
   * assina `?orgId=…&limit=…` nessa sequência.
   */
  it("monta a URL exata que o serviço espera", async () => {
    const chamadas = espiar({ turns: [], nextCursor: null });
    const { fetchMaxConversations } = await import("../admin-client");

    await fetchMaxConversations({ orgId: "org-1", limit: 20 });

    expect(chamadas[0].url).toBe(
      `${BASE}/api/admin/conversations?orgId=org-1&limit=20`
    );
  });

  it("assina método e caminho COM query — não o corpo vazio", async () => {
    const chamadas = espiar({ turns: [], nextCursor: null });
    const { fetchMaxConversations } = await import("../admin-client");

    await fetchMaxConversations({ orgId: "org-1", limit: 5 });

    const { url, headers } = chamadas[0];
    const ts = headers["X-Max-Timestamp"];
    const esperado = createHmac("sha256", SECRET)
      .update(payloadAssinado(url, ts))
      .digest("hex");

    expect(headers["X-Max-Signature"]).toBe(esperado);
    // E explicitamente NÃO o formato legado, que é o que deixava a query fora.
    const legado = createHmac("sha256", SECRET).update(`${ts}.`).digest("hex");
    expect(headers["X-Max-Signature"]).not.toBe(legado);
  });

  /**
   * A migração que fecha o `allowLegacyEmptyBody` do lado do serviço. Se este
   * teste cair, a tolerância ao formato antigo volta a ser necessária lá — e
   * com ela o replay cross-tenant de cinco minutos.
   */
  it("o status também migrou para o formato que cobre a query", async () => {
    const chamadas = espiar({ service: "max-agent" });
    const { fetchMaxStatus } = await import("../admin-client");

    await fetchMaxStatus("org-42");

    const { url, headers } = chamadas[0];
    expect(url).toContain("orgId=org-42");

    const ts = headers["X-Max-Timestamp"];
    const esperado = createHmac("sha256", SECRET)
      .update(payloadAssinado(url, ts))
      .digest("hex");
    expect(headers["X-Max-Signature"]).toBe(esperado);
  });

  /**
   * A assinatura é montada DEPOIS da query. Se alguém a mover para antes, o
   * `orgId` fica fora do que foi assinado e o serviço devolve 401 — falha
   * barulhenta, mas que custaria uma investigação. Este teste a nomeia.
   */
  it("orgId diferente muda a assinatura", async () => {
    const chamadas = espiar({ turns: [], nextCursor: null });
    const { fetchMaxConversations } = await import("../admin-client");

    await fetchMaxConversations({ orgId: "org-a" });
    await fetchMaxConversations({ orgId: "org-b" });

    expect(chamadas[0].headers["X-Max-Signature"]).not.toBe(
      chamadas[1].headers["X-Max-Signature"]
    );
  });

  it("sem env configurada não chama a rede", async () => {
    vi.stubEnv("MAX_NOTIFY_SECRET", "");
    const chamadas = espiar({});
    const { fetchMaxConversations } = await import("../admin-client");

    const r = await fetchMaxConversations({ orgId: "org-1" });

    expect(r).toEqual({ ok: false, reason: "not_configured" });
    expect(chamadas).toHaveLength(0);
  });

  it("401 do serviço vira motivo próprio, não erro genérico", async () => {
    espiar({}, 401);
    const { fetchMaxConversations } = await import("../admin-client");

    expect(await fetchMaxConversations({ orgId: "org-1" })).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });
});
