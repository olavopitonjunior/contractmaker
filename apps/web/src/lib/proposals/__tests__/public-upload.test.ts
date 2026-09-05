import { describe, it, expect } from "vitest";
import {
  evaluatePublicUploadGate,
  publicUploadPartyOptions,
  parsePublicAssignment,
  publicUploadDenialStatus,
  DEFAULT_PUBLIC_ASSIGNMENT,
} from "../public-upload";

const NOW = new Date("2026-09-04T12:00:00Z");
const FUTURE = new Date("2026-09-30T00:00:00Z");
const PAST = new Date("2026-09-01T00:00:00Z");

describe("evaluatePublicUploadGate — quando a proposta aceita documentos do lead", () => {
  // NEGADOS primeiro (rota pública sem auth: o que ela recusa é o contrato).
  it.each(["rascunho", "aguardando_aprovacao", "cancelada"])(
    "status que bloqueia o link público (%s) → blocked",
    (status) => {
      const r = evaluatePublicUploadGate({ status, kind: "locacao", validUntil: FUTURE }, NOW);
      expect(r).toEqual({ ok: false, reason: "blocked" });
    }
  );

  it.each(["convertida", "recusada_proponente", "recusada_vendedor"])(
    "terminal encerrado (%s) → closed",
    (status) => {
      const r = evaluatePublicUploadGate({ status, kind: "locacao", validUntil: FUTURE }, NOW);
      expect(r).toEqual({ ok: false, reason: "closed" });
    }
  );

  it("status expirada → expired (mesmo sem validUntil)", () => {
    const r = evaluatePublicUploadGate({ status: "expirada", kind: "locacao", validUntil: null }, NOW);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("validade vencida enquanto espera manifestação → expired", () => {
    const r = evaluatePublicUploadGate({ status: "enviada", kind: "locacao", validUntil: PAST }, NOW);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("validade vencida NÃO conta depois de assinada (aceita dentro do prazo)", () => {
    const r = evaluatePublicUploadGate(
      { status: "assinada_proponente", kind: "locacao", validUntil: PAST },
      NOW
    );
    expect(r).toEqual({ ok: true });
  });

  it("venda → kind (só locação recebe documentos por aqui)", () => {
    const r = evaluatePublicUploadGate({ status: "enviada", kind: "venda", validUntil: FUTURE }, NOW);
    expect(r).toEqual({ ok: false, reason: "kind" });
    expect(evaluatePublicUploadGate({ status: "enviada", kind: null, validUntil: FUTURE }, NOW).ok).toBe(false);
  });

  it.each([
    "enviada",
    "entregue",
    "visualizada",
    "assinada_proponente",
    "aguardando_vendedor",
    "completa",
    // falha_envio: a proposta continua viva para o lead (o link público também
    // não a bloqueia) — o corretor vai reenviar; documentos já ajudam.
    "falha_envio",
  ])(
    "locação viva (%s) dentro da validade → ok",
    (status) => {
      expect(evaluatePublicUploadGate({ status, kind: "locacao", validUntil: FUTURE }, NOW)).toEqual({ ok: true });
    }
  );

  it("404 só para token inválido; o resto é 403 (não vaza existência de token)", () => {
    expect(publicUploadDenialStatus("not_found")).toBe(404);
    for (const r of ["blocked", "closed", "expired", "kind", "feature_off"] as const) {
      expect(publicUploadDenialStatus(r)).toBe(403);
    }
  });
});

describe("publicUploadPartyOptions — vocabulário do lead", () => {
  it("1 locatário com caução: locatário, cônjuge e outro; sem locador/imóvel/fiador", () => {
    const opts = publicUploadPartyOptions({
      locatarios: [{ nome: "Maria" }],
      garantia: { tipo: "caucao" },
    });
    expect(opts.map((o) => o.value)).toEqual(["locatario:0", "conjuge_locatario:0", "outro:0"]);
    expect(opts[0].label).toBe("Locatário — Maria");
  });

  it("garantia fiador acrescenta fiador e cônjuge do fiador", () => {
    const opts = publicUploadPartyOptions({
      locatarios: [{ nome: "Maria" }, { razao_social: "ACME" }],
      garantia: { tipo: "fiador", fiador: { nome: "Fernando" } },
    });
    expect(opts.map((o) => o.value)).toEqual([
      "locatario:0",
      "locatario:1",
      "conjuge_locatario:0",
      "conjuge_locatario:1",
      "fiador:0",
      "conjuge_fiador:0",
      "outro:0",
    ]);
    expect(opts[1].label).toBe("Locatário 2 — ACME");
    expect(opts[4].label).toBe("Fiador — Fernando");
  });

  it("sem locatários ainda → mesmo assim oferece Locatário", () => {
    expect(publicUploadPartyOptions({})[0].value).toBe("locatario:0");
  });
});

describe("parsePublicAssignment — nunca 400: fora das opções cai no locatário 1", () => {
  const data = { locatarios: [{ nome: "Maria" }], garantia: { tipo: "caucao" } };

  it("opção oferecida → mantém", () => {
    expect(parsePublicAssignment({ kind: "conjuge_locatario", index: 0 }, data)).toEqual({
      kind: "conjuge_locatario",
      index: 0,
    });
  });

  it("fiador sem garantia por fiança → default", () => {
    expect(parsePublicAssignment({ kind: "fiador", index: 0 }, data)).toEqual(DEFAULT_PUBLIC_ASSIGNMENT);
  });

  it("locador (da imobiliária), índice fora, kind de venda, lixo → default", () => {
    expect(parsePublicAssignment({ kind: "locador", index: 0 }, data)).toEqual(DEFAULT_PUBLIC_ASSIGNMENT);
    expect(parsePublicAssignment({ kind: "locatario", index: 5 }, data)).toEqual(DEFAULT_PUBLIC_ASSIGNMENT);
    expect(parsePublicAssignment({ kind: "comprador", index: 0 }, data)).toEqual(DEFAULT_PUBLIC_ASSIGNMENT);
    expect(parsePublicAssignment("x", data)).toEqual(DEFAULT_PUBLIC_ASSIGNMENT);
    expect(parsePublicAssignment(undefined, data)).toEqual(DEFAULT_PUBLIC_ASSIGNMENT);
  });
});
