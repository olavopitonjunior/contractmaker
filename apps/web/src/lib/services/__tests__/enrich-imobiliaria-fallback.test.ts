import { describe, it, expect } from "vitest";
import { enrichContractData } from "../contract-generation";

/**
 * Fallback da intermediadora: quando o formulário do negócio não nomeou
 * corretora, o perfil da imobiliária (Organization) entra como comissionada.
 * Antes disso o CCV saía sem intermediadora e o corretor redigitava nome/CNPJ/
 * CRECI da própria imobiliária a cada negócio.
 */

const ORG = {
  imobiliaria: {
    nome: "Ativa Consultoria Imobiliaria Ltda",
    cnpj: "11.610.282/0001-65",
    creci: "25319-J",
  },
};

type Comissionado = Record<string, unknown>;

function comissionadosOf(enriched: Record<string, unknown>): Comissionado[] {
  const comissao = enriched.comissao as Record<string, unknown>;
  return (comissao.comissionados as Comissionado[]) ?? [];
}

describe("enrichContractData — fallback da imobiliária (perfil da org)", () => {
  it("usa o perfil da org quando o form não nomeou corretora e há comissão", () => {
    const enriched = enrichContractData(
      { comissao: { valor: 30000, percentual: 6 } },
      ORG
    );

    const [c] = comissionadosOf(enriched);
    expect(c).toBeDefined();
    expect(c.nome).toBe("Ativa Consultoria Imobiliaria Ltda");
    expect(c.cnpj).toBe("11.610.282/0001-65");
    expect(c.creci).toBe("25319-J");
    expect(c.papel).toBe("imobiliaria_principal");
    expect(c.tipo_pessoa).toBe("juridica");
  });

  it("o que veio do formulário VENCE o perfil da org", () => {
    const enriched = enrichContractData(
      {
        comissao: {
          valor: 30000,
          imobiliaria_nome: "Outra Corretora ME",
          imobiliaria_cnpj: "99.999.999/0001-99",
          creci: "00000-F",
        },
      },
      ORG
    );

    const [c] = comissionadosOf(enriched);
    expect(c.nome).toBe("Outra Corretora ME");
    expect(c.cnpj).toBe("99.999.999/0001-99");
    expect(c.creci).toBe("00000-F");
  });

  it("não carimba a imobiliária numa venda direta sem comissão", () => {
    const enriched = enrichContractData({ comissao: { valor: 0 } }, ORG);
    expect(comissionadosOf(enriched)).toHaveLength(0);
  });

  it("aceita comissão declarada só em percentual (sem valor fechado)", () => {
    const enriched = enrichContractData({ comissao: { percentual: 6 } }, ORG);
    const [c] = comissionadosOf(enriched);
    expect(c?.nome).toBe("Ativa Consultoria Imobiliaria Ltda");
  });

  it("não inventa comissionado quando a org não tem razão social cadastrada", () => {
    const enriched = enrichContractData(
      { comissao: { valor: 30000 } },
      { imobiliaria: { nome: undefined, cnpj: undefined, creci: undefined } }
    );
    expect(comissionadosOf(enriched)).toHaveLength(0);
  });

  it("sem ctx, o comportamento é o de antes (nenhum comissionado sintetizado)", () => {
    const enriched = enrichContractData({ comissao: { valor: 30000 } });
    expect(comissionadosOf(enriched)).toHaveLength(0);
  });

  it("não sobrescreve comissionados[] já existentes no form", () => {
    const enriched = enrichContractData(
      {
        comissao: {
          valor: 30000,
          comissionados: [
            { nome: "Captador Fulano", papel: "captador", percentual: 50 },
          ],
        },
      },
      ORG
    );

    const arr = comissionadosOf(enriched);
    expect(arr).toHaveLength(1);
    expect(arr[0].nome).toBe("Captador Fulano");
  });
});
