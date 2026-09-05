import { describe, expect, it, vi } from "vitest";
import {
  encodeForm,
  flattenFormFields,
  slPostForm,
  slPostJson,
  slWriteV2,
  SuperlogicaDuplicateError,
  SuperlogicaError,
  unwrapWriteResponse,
} from "../client";

const CREDS = { appToken: "app-token-xx", accessToken: "acc-token-xx" };

function stubFetch(status: number, body: unknown, text?: string) {
  const fetchMock = vi.fn(async () => {
    const t = text ?? JSON.stringify(body);
    return { ok: status < 400, status, text: async () => t, json: async () => JSON.parse(t) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("flattenFormFields / encodeForm", () => {
  it("usa a notação de colchetes da tela; null vira campo vazio; undefined some; boolean vira 0/1", () => {
    const flat = Object.fromEntries(
      flattenFormFields({
        ID_VENDA_VEN: 744,
        VENDEDORES: [{ ID_VENDEDOR_VEV: "115", ID_PESSOA_PES: "" }],
        COMISSOES: [{ ID_ITEM_VEI: null, NM: 1 }],
        FL_X: true,
        OMIT: undefined,
      })
    );
    expect(flat).toEqual({
      ID_VENDA_VEN: "744",
      "VENDEDORES[0][ID_VENDEDOR_VEV]": "115",
      "VENDEDORES[0][ID_PESSOA_PES]": "",
      "COMISSOES[0][ID_ITEM_VEI]": "",
      "COMISSOES[0][NM]": "1",
      FL_X: "1",
    });
    expect(encodeForm({ "A B": "x y", N: [1] })).toBe("A+B=x+y&N%5B0%5D=1");
  });
});

describe("unwrapWriteResponse", () => {
  it("resposta simples com status 2xx devolve data", () => {
    expect(unwrapWriteResponse({ status: "201", msg: "ok", data: { id: 1 } }, "caixa", 200)).toEqual({ data: { id: 1 }, msg: "ok" });
  });

  it("lote (multipleresponse) devolve o data do primeiro item", () => {
    const r = unwrapWriteResponse(
      { multipleresponse: "1", status: "200", msg: "Todos os itens…", data: [{ status: "200", msg: "Sucesso", data: { id_venda_ven: "745" } }] },
      "vendas/put",
      200
    );
    expect(r.data).toEqual({ id_venda_ven: "745" });
  });

  it("lote com erro no item lança com a mensagem do item (HTTP 200 por fora)", () => {
    expect(() =>
      unwrapWriteResponse(
        { multipleresponse: "1", status: "206", msg: "Todos os 1 itens foram processados COM ERRO.", data: [{ status: "500", msg: "Campo X obrigatório" }] },
        "vendas/put",
        200
      )
    ).toThrow(/Campo X obrigatório/);
  });

  it("anti-duplicidade vira SuperlogicaDuplicateError com o id existente (HTML escapado)", () => {
    const msg = "Já existe uma venda com essas informações. &lt;a href='https://apps.superlogica.net/imobiliaria/vendas/id/744' target='_blank'&gt;Venda#744&lt;/a&gt;";
    let err: unknown;
    try {
      unwrapWriteResponse({ multipleresponse: "1", status: "206", data: [{ status: "500", msg }] }, "vendas/put", 200);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SuperlogicaDuplicateError);
    expect((err as SuperlogicaDuplicateError).existingId).toBe("744");
    expect((err as Error).message).not.toContain("<a");
  });

  it("status 404 no corpo (rota inexistente) lança SuperlogicaError", () => {
    expect(() => unwrapWriteResponse({ status: "404", msg: "Desculpe, não conseguimos encontrar…" }, "vendas/putitem", 200)).toThrow(SuperlogicaError);
  });

  it("corpo sem status (null, {}, [], {error}, lote vazio) NUNCA é sucesso", () => {
    for (const body of [null, {}, [], { error: "x" }, { multipleresponse: "1", status: "200", data: [] }]) {
      expect(() => unwrapWriteResponse(body, "vendas/put", 200)).toThrow(SuperlogicaError);
    }
  });
});

describe("slPostForm / slPostJson / slWriteV2", () => {
  it("slPostForm envia form-urlencoded na base Imobiliárias com tokens só em header", async () => {
    const fetchMock = stubFetch(200, { multipleresponse: "1", status: "200", data: [{ status: "200", msg: "Sucesso", data: { id_venda_ven: "745" } }] });
    const r = await slPostForm<{ id_venda_ven: string }>(CREDS, "vendas/put", { ID_IMOVEL_IMO: "2088", VENDEDORES: [{ ID_VENDEDOR_VEV: "115" }] });
    expect(r.data.id_venda_ven).toBe("745");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://apps.superlogica.net/imobiliaria/api/vendas/put");
    expect(url).not.toContain("token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect((init.headers as Record<string, string>).app_token).toBe("app-token-xx");
    expect(init.body).toBe("ID_IMOVEL_IMO=2088&VENDEDORES%5B0%5D%5BID_VENDEDOR_VEV%5D=115");
  });

  it("slPostJson manda JSON e devolve o registro criado", async () => {
    const fetchMock = stubFetch(200, { multipleresponse: "1", status: "200", data: [{ status: "200", msg: "Sucesso", data: { id_pessoa_pes: "3883" } }] });
    const r = await slPostJson<{ id_pessoa_pes: string }>(CREDS, "proprietarios", { ST_NOME_PES: "Olavo", FL_PROPRIETARIOBENEFICIARIO_PES: 1 });
    expect(r.data.id_pessoa_pes).toBe("3883");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ ST_NOME_PES: "Olavo", FL_PROPRIETARIOBENEFICIARIO_PES: 1 });
  });

  it("slWriteV2 DELETE manda o id no corpo e aceita array de resposta", async () => {
    const fetchMock = stubFetch(200, [{ status: "200", msg: "Lançamento 67631 excluído.", idcolumnname: "0" }]);
    const r = await slWriteV2(CREDS, "DELETE", "caixa", { ID_CONTABANCO_MOV: 67631 });
    expect(r.msg).toContain("excluído");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.superlogica.net/v2/financeiro/caixa");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBe("ID_CONTABANCO_MOV=67631");
  });

  it("resposta HTML (Fatal error) vira SuperlogicaError, não exceção de JSON", async () => {
    stubFetch(200, null, "<br />\n<b>Fatal error</b>: Allowed memory size");
    await expect(slWriteV2(CREDS, "POST", "clientes", { ST_NOME_SAC: "x" })).rejects.toBeInstanceOf(SuperlogicaError);
  });
});
