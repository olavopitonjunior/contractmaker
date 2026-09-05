import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { superlogicaAccount: { upsert, findUnique: vi.fn() } },
}));
vi.mock("@/lib/security/crypto", () => ({
  encryptSecret: (plain: string) => ({ ciphertext: `enc(${plain})`, iv: "iv", tag: "tag" }),
  decryptSecret: () => "x",
}));

import { connectSuperlogicaAccount, SuperlogicaConnectError, validateSuperlogicaCreds } from "../connect";

type Handler = (url: string) => { status?: number; body: unknown; text?: string };

function stubFetch(handler: Handler) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const r = handler(url);
    const text = r.text ?? JSON.stringify(r.body);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => JSON.parse(text),
      text: async () => text,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const OK_IMOB = { status: "200", msg: "", data: [{ id_contrato_con: "1" }] };
const OK_FILIAIS = { status: "200", msg: "", data: [{ st_nome_fil: "Piton Imóveis" }] };
const OK_CAIXA = [
  { id_conta_cb: "1", st_descricao_cb: "Piton Imóveis" },
  { id_conta_cb: "6", st_descricao_cb: "Cofre HOLD" },
  { id_conta_cb: "1", st_descricao_cb: "Piton Imóveis" },
];
const BAD_TOKEN = {
  status: 500,
  msg: "Falha na requisição para: https://api.superlogica.net/v2/financeiro/apps/authinfo Erro: Client Id in the request, identified by HEADER app_token, is invalid. Check docs.sensedia.com",
};

describe("validateSuperlogicaCreds", () => {
  beforeEach(() => {
    upsert.mockReset();
  });

  it("valida nas duas APIs (Imobiliárias e Financeiro v2) e lê o nome da filial", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/imobiliaria/api/contratos")) return { body: OK_IMOB };
      if (url.includes("/imobiliaria/api/filiais")) return { body: OK_FILIAIS };
      if (url.includes("/v2/financeiro/caixa")) return { body: OK_CAIXA };
      throw new Error("url inesperada " + url);
    });
    const r = await validateSuperlogicaCreds({ appToken: "app-token-xx", accessToken: "acc-token-xx" });
    expect(r).toEqual({ accountName: "Piton Imóveis" });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/imobiliaria/api/contratos"))).toBe(true);
    expect(urls.some((u) => u.includes("/v2/financeiro/caixa"))).toBe(true);
    // Tokens vão só em HEADER, nunca na URL.
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain("app-token-xx");
      expect(url).not.toContain("acc-token-xx");
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers.app_token).toBe("app-token-xx");
      expect(headers.access_token).toBe("acc-token-xx");
    }
  });

  it("token inválido (gateway Sensedia) vira 400 com mensagem didática", async () => {
    stubFetch((url) => {
      if (url.includes("contratos")) return { body: BAD_TOKEN };
      throw new Error("não deveria chamar " + url);
    });
    await expect(
      validateSuperlogicaCreds({ appToken: "app-token-xx", accessToken: "acc-token-xx" })
    ).rejects.toMatchObject({ name: "SuperlogicaConnectError", status: 400 });
  });

  it("resposta não-JSON da v2 (Fatal error em HTML) vira 502, não 400", async () => {
    stubFetch((url) => {
      if (url.includes("contratos")) return { body: OK_IMOB };
      if (url.includes("caixa")) return { body: null, text: "<br />\n<b>Fatal error</b>: Allowed memory size" };
      throw new Error("não deveria chamar " + url);
    });
    await expect(
      validateSuperlogicaCreds({ appToken: "app-token-xx", accessToken: "acc-token-xx" })
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("connectSuperlogicaAccount", () => {
  beforeEach(() => {
    upsert.mockReset();
  });

  it("rejeita licença fora do padrão antes de bater na rede", async () => {
    const fetchMock = stubFetch(() => ({ body: OK_IMOB }));
    await expect(
      connectSuperlogicaAccount({
        orgId: "org1",
        userId: "u1",
        licenca: "ADM 037585!",
        appToken: "app-token-xx",
        accessToken: "acc-token-xx",
      })
    ).rejects.toBeInstanceOf(SuperlogicaConnectError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("grava os dois tokens cifrados, status connected e nome da conta", async () => {
    stubFetch((url) => {
      if (url.includes("contratos")) return { body: OK_IMOB };
      if (url.includes("filiais")) return { body: OK_FILIAIS };
      if (url.includes("caixa")) return { body: OK_CAIXA };
      throw new Error("url inesperada " + url);
    });
    const r = await connectSuperlogicaAccount({
      orgId: "org1",
      userId: "u1",
      licenca: "ADM037585",
      appToken: " app-token-xx ",
      accessToken: "acc-token-xx",
    });
    expect(r).toMatchObject({ ok: true, status: "connected", licenca: "adm037585", accountName: "Piton Imóveis" });
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ orgId: "org1" });
    expect(args.create.appTokenEncrypted).toBe("enc(app-token-xx)");
    expect(args.create.accessTokenEncrypted).toBe("enc(acc-token-xx)");
    expect(args.create.status).toBe("connected");
    // Nada em claro no registro.
    expect(JSON.stringify(args)).not.toContain('"app-token-xx"');
  });

  it("não persiste nada quando a validação falha", async () => {
    stubFetch(() => ({ body: BAD_TOKEN }));
    await expect(
      connectSuperlogicaAccount({
        orgId: "org1",
        userId: "u1",
        licenca: "adm037585",
        appToken: "app-token-xx",
        accessToken: "acc-token-xx",
      })
    ).rejects.toBeInstanceOf(SuperlogicaConnectError);
    expect(upsert).not.toHaveBeenCalled();
  });
});
