import { describe, it, expect } from "vitest";
import { maxServiceUrl } from "../endpoint";

/**
 * O bug que este arquivo existe para impedir: três chamadores montando a URL do
 * mesmo serviço de três formas, duas delas corretas para valores OPOSTOS de
 * `MAX_NOTIFY_URL`. O 404 resultante não é ruidoso — vira `delivered: false` e
 * `status: "failed"`, que parecem "serviço fora do ar".
 *
 * A propriedade que interessa não é o formato de uma URL: é que **os dois
 * formatos de base cheguem no MESMO lugar**.
 */
describe("maxServiceUrl", () => {
  const HOST = "https://max-agent.exemplo.app";
  const CAMINHOS = ["/api/notify", "/api/orgs", "/api/admin/status"] as const;

  it.each(CAMINHOS)("host puro e host com /api convergem em %s", (path) => {
    const puro = maxServiceUrl(HOST, path).toString();
    const comApi = maxServiceUrl(`${HOST}/api`, path).toString();

    expect(puro).toBe(comApi);
    expect(puro).toBe(`${HOST}${path}`);
  });

  it("barra no fim não duplica nem muda o destino", () => {
    expect(maxServiceUrl(`${HOST}/`, "/api/notify").toString()).toBe(
      `${HOST}/api/notify`
    );
    expect(maxServiceUrl(`${HOST}/api/`, "/api/notify").toString()).toBe(
      `${HOST}/api/notify`
    );
  });

  /**
   * Todas as rotas do serviço vivem sob `/api/`. Um caminho sem a barra inicial
   * seria RELATIVO à base e reintroduziria a dependência do formato — é
   * exatamente a forma do bug original.
   */
  it("todo caminho declarado começa na raiz", () => {
    for (const p of CAMINHOS) expect(p.startsWith("/api/")).toBe(true);
  });

  it("preserva host e porta", () => {
    const url = maxServiceUrl("http://localhost:3001", "/api/orgs");
    expect(url.toString()).toBe("http://localhost:3001/api/orgs");
  });
});
