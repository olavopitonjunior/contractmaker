import { describe, it, expect } from "vitest";
import { resolveObterEndpoint } from "../executor";

/**
 * Phase L — garante que TODO fluxo two-step resolve o endpoint do 2º passo.
 * Antes só tjsp/tjrj/trf3 eram mapeados; ONR matrícula, TJMS e Antecedentes PF
 * caíam em null e o job ficava preso eternamente em awaiting_portal.
 */
describe("resolveObterEndpoint — mapeamento two-step", () => {
  const cases: Array<[string, string]> = [
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
