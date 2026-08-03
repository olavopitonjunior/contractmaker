import { describe, it, expect } from "vitest";
import {
  extractAcceptanceRecordUrl,
  extractAcceptanceFacts,
} from "../acceptance-record";

/**
 * Resposta REAL documentada do `GET /api/v3/acceptance_term/whatsapps/{id}`:
 * só metadados, nenhum link. É o caso base — a função tem que devolver null aqui,
 * senão o webhook sairia baixando qualquer coisa.
 */
const DOCUMENTED_RESPONSE = {
  data: {
    id: "ac4acc7f-287b-47ab-a2c9-552b3675eabe",
    type: "acceptance_term_whatsapps",
    attributes: {
      sender_phone: null,
      signer_phone: "11967211170",
      signer_name: "Adélia Barbosa",
      sender_name_option: "account_name",
      sent_at: "2026-08-03T16:28:20Z",
      status: "completed",
      status_flow: "enqueued_sent_completed",
      title: "Proposta nº jd5xtbrv",
      message: "Proposta nº jd5xtbrv — Apto 32. Declaro que li a Proposta e aceito.",
      created: "2026-08-03T16:28:15Z",
      modified: "2026-08-03T16:31:26Z",
    },
  },
};

describe("extractAcceptanceRecordUrl", () => {
  it("devolve null na resposta documentada (sem link) — o caso de hoje", () => {
    expect(extractAcceptanceRecordUrl(DOCUMENTED_RESPONSE)).toBeNull();
  });

  it("acha link em data.links, que é onde JSON:API o colocaria", () => {
    const resp = {
      data: {
        ...DOCUMENTED_RESPONSE.data,
        links: { self: "https://app.clicksign.com/api/v3/acceptance_term/whatsapps/x" },
      },
    };
    // `self` casa por causa do container `links` — é o comportamento desejado:
    // preferimos um falso positivo raro a perder o campo por não conhecer o nome.
    expect(extractAcceptanceRecordUrl(resp)).toBe(
      "https://app.clicksign.com/api/v3/acceptance_term/whatsapps/x"
    );
  });

  it("acha link em attributes com nome não documentado", () => {
    const resp = {
      data: {
        ...DOCUMENTED_RESPONSE.data,
        attributes: {
          ...DOCUMENTED_RESPONSE.data.attributes,
          record_url: "https://files.clicksign.com/registro-aceite.pdf",
        },
      },
    };
    expect(extractAcceptanceRecordUrl(resp)).toBe(
      "https://files.clicksign.com/registro-aceite.pdf"
    );
  });

  it("ignora http: — downgrade viraria fetch inseguro e o safeFetch recusaria", () => {
    const resp = { data: { links: { record: "http://files.clicksign.com/a.pdf" } } };
    expect(extractAcceptanceRecordUrl(resp)).toBeNull();
  });

  it("ignora valores que não são URL, mesmo em chave sugestiva", () => {
    const resp = { data: { attributes: { document_url: "não-informado" } } };
    expect(extractAcceptanceRecordUrl(resp)).toBeNull();
  });

  it("ignora URL válida cuja chave não sugere artefato", () => {
    const resp = { data: { attributes: { callback: "https://exemplo.com/x" } } };
    expect(extractAcceptanceRecordUrl(resp)).toBeNull();
  });

  it("prefere o campo raso ao profundo (busca em largura)", () => {
    const resp = {
      data: {
        links: { record: "https://a.clicksign.com/raso.pdf" },
        attributes: { nested: { deep: { report_url: "https://a.clicksign.com/fundo.pdf" } } },
      },
    };
    expect(extractAcceptanceRecordUrl(resp)).toBe("https://a.clicksign.com/raso.pdf");
  });

  it("não estoura em null/primitivo/ciclo", () => {
    expect(extractAcceptanceRecordUrl(null)).toBeNull();
    expect(extractAcceptanceRecordUrl("texto")).toBeNull();
    const cyclic: Record<string, unknown> = { data: {} };
    (cyclic.data as Record<string, unknown>).self = cyclic;
    expect(extractAcceptanceRecordUrl(cyclic)).toBeNull();
  });
});

describe("extractAcceptanceFacts", () => {
  it("lê os atributos oficiais do shape JSON:API", () => {
    const f = extractAcceptanceFacts(DOCUMENTED_RESPONSE);
    expect(f.status).toBe("completed");
    expect(f.statusFlow).toBe("enqueued_sent_completed");
    expect(f.signerName).toBe("Adélia Barbosa");
    expect(f.signerPhone).toBe("11967211170");
    expect(f.sentAt).toBe("2026-08-03T16:28:20Z");
    expect(f.message).toContain("Declaro que li a Proposta");
  });

  it("devolve objeto vazio quando não há attributes (API fora do ar)", () => {
    expect(extractAcceptanceFacts(null)).toEqual({});
    expect(extractAcceptanceFacts({ data: {} })).toEqual({});
  });

  it("normaliza string vazia pra null, pra capa cair no travessão", () => {
    const f = extractAcceptanceFacts({ data: { attributes: { status: "" } } });
    expect(f.status).toBeNull();
  });
});
