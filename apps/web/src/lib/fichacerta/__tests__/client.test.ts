import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  addApplicant,
  callFichaCerta,
  createSolicitation,
  deleteApplicant,
  deleteSolicitation,
  deleteWebhook,
  downloadReportPdf,
  getCredits,
  getReport,
  getSolicitation,
  listWebhooks,
  registerWebhook,
  reprocessReport,
  requestReport,
  sanitizeForPayload,
  updateApplicant,
} from "../client";
import error422 from "@/lib/certidoes/__tests__/fixtures/fichacerta-error-422.json";
import { FichaCertaError } from "../types";
import type { FichaCertaCreds } from "../account";

const creds: FichaCertaCreds = {
  orgId: "org1",
  login: "api@imob.com.br",
  password: "s3gr3d0",
  baseUrl: "https://stage-api.fichacertadigital.com.br",
  products: [1, 9],
  costCents: 1500,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("callFichaCerta", () => {
  it("manda login/password nos headers e JSON no corpo; nunca no body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 219, message: "Solicitação cadastrada" }));
    const out = await createSolicitation(creds, {
      produtos: [1, 9],
      locacao: { tipo_imovel: "RESIDENCIAL", aluguel: "5000" },
      pretendente: {
        tipo_pretendente: "INQUILINO",
        nome: "X",
        cpf: "64619844705",
        residir: true,
        renda: { principal: { origem: 3, valor: "5000" }, outra: { origem: "" } },
      },
    });
    expect(out.id).toBe(219);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://stage-api.fichacertadigital.com.br/solicitation/");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.login).toBe("api@imob.com.br");
    expect(headers.password).toBe("s3gr3d0");
    expect(String(init.body)).not.toContain("s3gr3d0");
  });

  it("422 vira FichaCertaError com a mensagem deles e o body (fixture da doc)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, error422));
    await expect(callFichaCerta(creds, "POST", "solicitation/", {})).rejects.toMatchObject({
      name: "FichaCertaError",
      status: 422,
      message: expect.stringContaining("pretendente.participante"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 não faz retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: "Unauthorized" }));
    await expect(getCredits(creds)).rejects.toBeInstanceOf(FichaCertaError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx faz UM retry e devolve o sucesso da segunda", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(502, { message: "bad gateway" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { credito_disponivel: 4972 } }));
    expect(await getCredits(creds)).toBe(4972);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("5xx duas vezes → erro com status 5xx", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: "boom" }));
    await expect(getCredits(creds)).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rede caída → FichaCertaError status 0", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(getCredits(creds)).rejects.toMatchObject({ status: 0 });
  });

  it("créditos: resposta sem número → 0", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: {} }));
    expect(await getCredits(creds)).toBe(0);
  });

  it("download do PDF devolve Buffer", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 })
    );
    const buf = await downloadReportPdf(creds, 220);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/solicitation/220/report/download");
  });

  it("registerWebhook posta o contrato deles (endpoint, token_url, token_user, token_password)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 2, message: "Webhook cadastrado" }));
    const r = await registerWebhook(creds, {
      endpoint: "https://x/api/webhooks/fichacerta/abc?k=s",
      token_url: "https://x/api/webhooks/fichacerta/abc/token",
      token_user: "fc_abc",
      token_password: "p",
    });
    expect(r.id).toBe(2);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: "https://x/api/webhooks/fichacerta/abc?k=s",
      token_url: "https://x/api/webhooks/fichacerta/abc/token",
      token_user: "fc_abc",
      token_password: "p",
    });
  });

  it("cada wrapper bate no método e caminho da doc (barra final só nos POST de criação)", async () => {
    const cases: Array<[() => Promise<unknown>, string, string, boolean]> = [
      [() => getSolicitation(creds, 12), "GET", "solicitation/12", false],
      [() => deleteSolicitation(creds, 12), "DELETE", "solicitation/12", false],
      [() => addApplicant(creds, 12, { produtos: [1], pretendente: { tipo_pretendente: "OUTROS", razao_social: "X", cnpj: "1" } }), "POST", "solicitation/12/applicant/", true],
      [() => updateApplicant(creds, 12, 34, { pretendente: { oculto: true } }), "PUT", "solicitation/12/applicant/34", true],
      [() => deleteApplicant(creds, 12, 34), "DELETE", "solicitation/12/applicant/34", false],
      [() => requestReport(creds, 12), "POST", "solicitation/12/report", true],
      [() => reprocessReport(creds, 12), "PUT", "solicitation/12/report", false],
      [() => getReport(creds, 12), "GET", "solicitation/12/report", false],
      [() => listWebhooks(creds), "GET", "solicitation/report/webhook", false],
      [() => deleteWebhook(creds, 2), "DELETE", "solicitation/report/webhook/2", false],
    ];
    for (const [call, method, path, hasBody] of cases) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, method === "GET" && path.endsWith("webhook") ? [] : { ok: true }));
      await call();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${creds.baseUrl}/${path}`);
      expect(init.method).toBe(method);
      expect("body" in init && init.body !== undefined).toBe(hasBody);
      const headers = init.headers as Record<string, string>;
      expect(headers.login).toBe(creds.login);
      if (!hasBody) expect(headers["Content-Type"]).toBeUndefined();
    }
  });

  it("sanitizeForPayload remove login/password se alguém os colocar no corpo", () => {
    expect(sanitizeForPayload({ a: 1, login: "x", password: "y" })).toEqual({ a: 1 });
  });
});
