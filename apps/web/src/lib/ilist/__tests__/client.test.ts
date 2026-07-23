import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetIListTokenCache,
  createIListClient,
  fromSentinel,
  integratorIdForRegion,
  redactIListRecord,
} from "../client";
import type { IListEnv } from "../env";

const ENV: IListEnv = {
  baseUrl: "https://rexapi.test.local",
  apiKey: "API-KEY",
  secretKey: "SECRET-KEY",
};

function tokenResponse(token = "tok-1") {
  return new Response(
    JSON.stringify({ access_token: token, token_type: "token", expires_in: 172800 }),
    { status: 200 },
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("ilist client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetIListTokenCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("integratorIdForRegion deriva {regionId}001", () => {
    expect(integratorIdForRegion(71)).toBe(71001);
    expect(integratorIdForRegion(60)).toBe(60001);
  });

  it("fromSentinel normaliza -999 e não-números", () => {
    expect(fromSentinel(-999)).toBeUndefined();
    expect(fromSentinel(undefined)).toBeUndefined();
    expect(fromSentinel(null)).toBeUndefined();
    expect(fromSentinel(0)).toBe(0);
    expect(fromSentinel(655000)).toBe(655000);
  });

  it("token: body começa com '=' e vai URL-encoded", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ Items: [] }));

    const client = createIListClient(71, ENV);
    await client.offices.list({ page: 1, take: 5 });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://rexapi.test.local/api/v1/oauth/token");
    const body = tokenInit.body as string;
    expect(body.startsWith("=")).toBe(true);
    expect(body).toContain(encodeURIComponent("grant_type=authorization_code"));
    expect(body).toContain("API-KEY");
    expect(body).toContain("SECRET-KEY");
  });

  it("requests autenticadas usam header OAUTH + api_key e o integrator na rota", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-abc"))
      .mockResolvedValueOnce(jsonResponse({ Items: [] }));

    const client = createIListClient(71, ENV);
    await client.properties.list({ page: 2, take: 100, all: true, officeID: 71003 });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain("/api/v1/integrator/71001/properties?");
    expect(url).toContain("page=2");
    expect(url).toContain("officeID=71003");
    expect(url).toContain("all=true");
    expect(init.headers.Authorization).toBe('OAUTH oauth_token="tok-abc", api_key="API-KEY"');
  });

  it("token é cacheado entre chamadas (1 só POST de token)", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ Items: [] }))
      .mockResolvedValueOnce(jsonResponse({ Items: [] }));

    const client = createIListClient(71, ENV);
    await client.offices.list({ page: 1, take: 5 });
    await client.associates.list({ page: 1, take: 5 });

    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("oauth/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("geodata.cities força clientRegionID (sem ele a API devolve a base mundial)", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ Items: [], TotalCount: 0, HasNextPage: false }));

    const client = createIListClient(71, ENV);
    await client.geodata.cities(1, 100);

    const [url] = fetchMock.mock.calls[1];
    expect(url).toContain("/integrator/71001/geodata?");
    expect(url).toContain("geoLevel=cities");
    // O parâmetro crítico: sem clientRegionID a API retorna ~1,5M cidades.
    expect(url).toContain("clientRegionID=71");
  });

  it("re-auth única em 401 (token expirado na fronteira)", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-velho"))
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("tok-novo"))
      .mockResolvedValueOnce(jsonResponse({ Items: [{ ID: 1 }] }));

    const client = createIListClient(71, ENV);
    const res = await client.offices.list({ page: 1, take: 5 });
    expect(res.Items).toHaveLength(1);

    const lastCall = fetchMock.mock.calls.at(-1)!;
    expect(lastCall[1].headers.Authorization).toContain("tok-novo");
  });

  it("SEGURANÇA: IListCredentials é redigido de qualquer resposta (inclusive aninhada)", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        Items: [
          {
            ID: 710031017,
            AgentName: "Camila Herrero",
            IListCredentials: { Username: "user", Password: "senha-em-claro" },
          },
        ],
      }),
    );

    const client = createIListClient(71, ENV);
    const res = await client.associates.list({ page: 1, take: 5 });

    expect(JSON.stringify(res)).not.toContain("senha-em-claro");
    expect(JSON.stringify(res)).not.toContain("IListCredentials");
    expect(res.Items[0].AgentName).toBe("Camila Herrero");
  });

  it("normaliza o typo ExternaID → ExternalID", () => {
    const rec = redactIListRecord({ ID: "710031002-1", ExternaID: "abc" } as never) as Record<
      string,
      unknown
    >;
    expect(rec.ExternalID).toBe("abc");
    expect(rec.ExternaID).toBeUndefined();
  });

  it("erro HTTP vira IListError com status e endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const client = createIListClient(71, ENV);
    await expect(client.properties.get("nao-existe")).rejects.toMatchObject({
      name: "IListError",
      status: 404,
    });
  });
});
