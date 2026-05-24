import { describe, it, expect } from "vitest";
import { resolveObterEndpoint, buildObterArgs, pickRecoverableProtocol } from "../executor";

/**
 * Phase L — garante que TODO fluxo two-step resolve o endpoint do 2º passo.
 * Antes só tjsp/tjrj/trf3 eram mapeados; ONR matrícula, TJMS e Antecedentes PF
 * caíam em null e o job ficava preso eternamente em awaiting_portal.
 */
describe("resolveObterEndpoint — mapeamento two-step", () => {
  const cases: Array<[string, string]> = [
    ["tribunal/tjsp/pedido-certidao", "tribunal/tjsp/obter-certidao"],
    ["tribunal/tjsp/pedido-civel", "tribunal/tjsp/obter-civel"],
    ["tribunal/tjrj/pedido-cert", "tribunal/tjrj/obter-certidao"],
    ["tribunal/trf3/certidao-distr", "tribunal/trf3/obter-certidao"],
    ["tribunal/tjms/pedido-cert", "tribunal/tjms/obter-certidao"],
    ["registradores/matric-pedido", "registradores/matric-download"],
    ["antecedentes-criminais/pf/emit", "antecedentes-criminais/pf/val"],
  ];

  it.each(cases)("%s → %s", (pedido, obter) => {
    expect(resolveObterEndpoint(pedido)).toBe(obter);
  });

  it("endpoint single-step → null", () => {
    expect(resolveObterEndpoint("receita-federal/pgfn")).toBeNull();
  });
});

describe("buildObterArgs — params do 2º passo por portal", () => {
  const payloadPF = { cpf: "12345678900", nome: "Fulano" };
  const payloadPJ = { cnpj: "11222333000144" };

  it("TJSP e-SAJ → numero_pedido + pedido_data + cpf", () => {
    expect(
      buildObterArgs("tribunal/tjsp/obter-civel", {
        numeroPedido: "1610335",
        pedidoData: "22/05/2026",
        payload: payloadPF,
      })
    ).toEqual({ numero_pedido: "1610335", pedido_data: "22/05/2026", cpf: "12345678900" });
  });

  it("TJSP obter-certidao → numero_pedido + pedido_data + cpf (mesmo shape do obter-civel)", () => {
    expect(
      buildObterArgs("tribunal/tjsp/obter-certidao", {
        numeroPedido: "96931058",
        pedidoData: "23/05/2026",
        payload: payloadPF,
      })
    ).toEqual({ numero_pedido: "96931058", pedido_data: "23/05/2026", cpf: "12345678900" });
  });

  it("TJRJ e-SAJ → numero_pedido + pedido_data + cnpj", () => {
    expect(
      buildObterArgs("tribunal/tjrj/obter-certidao", {
        numeroPedido: "ABC",
        pedidoData: "01/01/2026",
        payload: payloadPJ,
      })
    ).toEqual({ numero_pedido: "ABC", pedido_data: "01/01/2026", cnpj: "11222333000144" });
  });

  it("TJSP sem pedido_data → omite o campo", () => {
    expect(
      buildObterArgs("tribunal/tjsp/obter-civel", {
        numeroPedido: "X",
        payload: payloadPF,
      })
    ).toEqual({ numero_pedido: "X", cpf: "12345678900" });
  });

  it("TRF3 → numero_certidao + documento (não numero_pedido)", () => {
    expect(
      buildObterArgs("tribunal/trf3/obter-certidao", {
        numeroPedido: "CERT-9",
        pedidoData: "22/05/2026",
        payload: payloadPF,
      })
    ).toEqual({ numero_certidao: "CERT-9", cpf: "12345678900" });
  });

  it("Antecedentes PF → codigo + cpf", () => {
    expect(
      buildObterArgs("antecedentes-criminais/pf/val", {
        numeroPedido: "COD1",
        payload: payloadPF,
      })
    ).toEqual({ codigo: "COD1", cpf: "12345678900" });
  });

  it("default (ONR matrícula) → só numero_pedido", () => {
    expect(
      buildObterArgs("registradores/matric-download", {
        numeroPedido: "M-1",
        payload: payloadPF,
      })
    ).toEqual({ numero_pedido: "M-1" });
  });
});

describe("pickRecoverableProtocol — recupera protocolo do pedido original (620)", () => {
  const d = (s: string) => new Date(s);

  it("recupera numero_pedido do MESMO tipo (TJSP tem 4 tipos no mesmo endpoint)", () => {
    const priors = [
      { requestPayload: { tipo_certidao: "falencia" }, resultData: { numero_pedido: "FAL-1" }, createdAt: d("2026-05-20") },
      { requestPayload: { tipo_certidao: "civel" }, resultData: { numero_pedido: "CIV-1", pedido_data: "18/05/2026" }, createdAt: d("2026-05-18") },
    ];
    expect(pickRecoverableProtocol("civel", priors)).toEqual({
      numeroPedido: "CIV-1",
      pedidoData: "18/05/2026",
    });
  });

  it("ignora protocolo de tipo diferente", () => {
    const priors = [
      { requestPayload: { tipo_certidao: "falencia" }, resultData: { numero_pedido: "FAL-1" }, createdAt: d("2026-05-20") },
    ];
    expect(pickRecoverableProtocol("civel", priors)).toBeNull();
  });

  it("sem pedido_data no prior → formata o createdAt (DD/MM/YYYY)", () => {
    const priors = [
      { requestPayload: { tipo_certidao: "civel" }, resultData: { numero_pedido: "CIV-9" }, createdAt: d("2026-05-21T12:00:00") },
    ];
    expect(pickRecoverableProtocol("civel", priors)).toEqual({
      numeroPedido: "CIV-9",
      pedidoData: "21/05/2026",
    });
  });

  it("currentTipo undefined (endpoint sem tipo) → casa qualquer", () => {
    const priors = [
      { requestPayload: {}, resultData: { numero_pedido: "X-1", pedido_data: "01/01/2026" }, createdAt: d("2026-01-01") },
    ];
    expect(pickRecoverableProtocol(undefined, priors)).toEqual({
      numeroPedido: "X-1",
      pedidoData: "01/01/2026",
    });
  });

  it("nenhum prior com numero_pedido → null", () => {
    const priors = [
      { requestPayload: { tipo_certidao: "civel" }, resultData: { duplicate_pending: true, numero_pedido: null }, createdAt: d("2026-05-20") },
      { requestPayload: { tipo_certidao: "civel" }, resultData: null, createdAt: d("2026-05-19") },
    ];
    expect(pickRecoverableProtocol("civel", priors)).toBeNull();
  });
});
