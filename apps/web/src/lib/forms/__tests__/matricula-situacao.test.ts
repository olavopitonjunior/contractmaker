import { describe, it, expect } from "vitest";
import { matriculaConditionalPaths } from "@/lib/forms/party-required";
import { dadosContratoSchema } from "@/lib/forms/validation";
import {
  pendenciasDeMatricula,
  pendenciasNaoResolvidas,
} from "@/components/pipeline/MatriculaPendenteBanner";

/**
 * A matrícula atualizada tem validade de 30 dias e é o documento sem o qual a
 * escritura não se lavra. O formulário passa a perguntar se ela existe ou se
 * precisa ser pedida ao registro — e "precisa ser pedida" só é acionável com
 * número e cartório, daí a obrigatoriedade condicional.
 */
describe("matriculaConditionalPaths", () => {
  const get = (data: Record<string, unknown>) => (path: string) => {
    let cur: unknown = data;
    for (const part of path.split(".")) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  };

  it("'solicitar' exige número e cartório do imóvel", () => {
    const paths = matriculaConditionalPaths(
      get({ imoveis: [{ matricula_situacao: "solicitar" }] })
    );
    expect(paths).toEqual(["imoveis.0.matricula", "imoveis.0.cartorio"]);
  });

  it("'possui' não exige nada", () => {
    expect(
      matriculaConditionalPaths(get({ imoveis: [{ matricula_situacao: "possui" }] }))
    ).toEqual([]);
  });

  it("formulário legado (campo ausente) não exige nada — sem pendência retroativa", () => {
    expect(matriculaConditionalPaths(get({ imoveis: [{ matricula: "123" }] }))).toEqual([]);
  });

  it("cobre TODOS os imóveis, não só o primeiro", () => {
    const paths = matriculaConditionalPaths(
      get({
        imoveis: [
          { matricula_situacao: "possui" },
          { matricula_situacao: "solicitar" },
          { matricula_situacao: "solicitar" },
        ],
      })
    );
    expect(paths).toEqual([
      "imoveis.1.matricula",
      "imoveis.1.cartorio",
      "imoveis.2.matricula",
      "imoveis.2.cartorio",
    ]);
  });
});

describe("superRefine da matrícula (relatório de issues do finalize)", () => {
  // `pagamento` precisa existir: o `superRefine` só roda depois do parse do
  // objeto base, então uma fixture incompleta faria o teste passar/falhar pelo
  // motivo errado (foi o que aconteceu na primeira versão deste arquivo).
  const base = {
    vendedores: [{ tipo_pessoa: "fisica", nome: "Fulano de Tal" }],
    compradores: [{ tipo_pessoa: "fisica", nome: "Beltrano de Tal" }],
    imoveis: [{ descricao: "Apartamento com dois quartos e uma vaga." }],
    pagamento: { valor_total: 0, sinal_arras: 0, recursos_proprios: 0 },
  };
  const issuePaths = (data: Record<string, unknown>) => {
    const r = dadosContratoSchema.safeParse(data);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("'solicitar' sem número e sem cartório gera as duas issues", () => {
    const paths = issuePaths({
      ...base,
      imoveis: [{ ...base.imoveis[0], matricula_situacao: "solicitar" }],
    });
    expect(paths).toContain("imoveis.0.matricula");
    expect(paths).toContain("imoveis.0.cartorio");
  });

  it("'solicitar' com os dois preenchidos não gera issue de matrícula", () => {
    const paths = issuePaths({
      ...base,
      imoveis: [
        {
          ...base.imoveis[0],
          matricula_situacao: "solicitar",
          matricula: "12.345",
          cartorio: "1º RI de Curitiba",
        },
      ],
    });
    expect(paths).not.toContain("imoveis.0.matricula");
    expect(paths).not.toContain("imoveis.0.cartorio");
  });

  it("'possui' e legado não geram issue nenhuma de matrícula", () => {
    for (const situacao of ["possui", undefined]) {
      const paths = issuePaths({
        ...base,
        imoveis: [{ ...base.imoveis[0], matricula_situacao: situacao }],
      });
      expect(paths).not.toContain("imoveis.0.matricula");
      expect(paths).not.toContain("imoveis.0.cartorio");
    }
  });
});

describe("pendência de matrícula na tela do negócio", () => {
  it("lista só os imóveis a solicitar, com endereço e dados do pedido", () => {
    const p = pendenciasDeMatricula({
      imoveis: [
        { rua: "Rua A", numero: "10", matricula_situacao: "possui" },
        {
          rua: "Rua B",
          numero: "20",
          matricula_situacao: "solicitar",
          matricula: "9.876",
          cartorio: "2º RI",
        },
      ],
    });
    expect(p).toEqual([
      { label: "Rua B, 20", matricula: "9.876", cartorio: "2º RI" },
    ]);
  });

  it("imóvel sem endereço cai no rótulo por posição", () => {
    const p = pendenciasDeMatricula({
      imoveis: [{ matricula_situacao: "solicitar" }],
    });
    expect(p[0].label).toBe("Imóvel 1");
  });

  it("formulário legado não gera pendência", () => {
    expect(pendenciasDeMatricula({ imoveis: [{ rua: "Rua A" }] })).toEqual([]);
    expect(pendenciasDeMatricula(null)).toEqual([]);
  });
});

describe("pendenciasNaoResolvidas — o que apaga o aviso", () => {
  const pend = (label: string, matricula = "") => ({
    label,
    matricula,
    cartorio: "1º RI",
  });
  const anexo = (
    category: string | null,
    source: string | null,
    numero?: string
  ) => ({
    category,
    source,
    extractedData: numero ? { matricula_numero: numero } : null,
  });

  it("anexo copiado DO FORMULÁRIO não resolve (foi ele que motivou o pedido)", () => {
    const p = [pend("Rua A")];
    expect(pendenciasNaoResolvidas(p, [anexo("matricula", "form")])).toEqual(p);
  });

  it("upload manual e certidão emitida resolvem; outra categoria não", () => {
    const p = [pend("Rua A")];
    expect(pendenciasNaoResolvidas(p, [anexo("matricula", "manual")])).toEqual([]);
    expect(pendenciasNaoResolvidas(p, [anexo("matricula", "infosimples")])).toEqual([]);
    expect(pendenciasNaoResolvidas(p, [anexo("matricula_anexada", "manual")])).toEqual([]);
    expect(pendenciasNaoResolvidas(p, [anexo("iptu", "manual")])).toEqual(p);
  });

  /**
   * O caso que motivou este bloco: um `.some()` sobre a lista de anexos apagava
   * o aviso do imóvel 2 assim que a matrícula do imóvel 1 chegava — justamente
   * quando o aviso mais importa.
   */
  it("matrícula do imóvel 1 NÃO apaga a pendência do imóvel 2", () => {
    const p = [pend("Rua A", "111"), pend("Rua B", "222")];
    const restantes = pendenciasNaoResolvidas(p, [
      anexo("matricula", "manual", "111"),
    ]);
    expect(restantes).toEqual([pend("Rua B", "222")]);
  });

  it("casa por número mesmo com máscara diferente", () => {
    const p = [pend("Rua A", "12.345")];
    expect(pendenciasNaoResolvidas(p, [anexo("matricula", "manual", "12345")])).toEqual(
      []
    );
  });

  it("anexo sem número legível abate UMA pendência, não todas", () => {
    const p = [pend("Rua A", "111"), pend("Rua B", "222")];
    expect(pendenciasNaoResolvidas(p, [anexo("matricula", "manual")])).toHaveLength(1);
  });

  it("dois anexos genéricos para dois imóveis zeram o aviso", () => {
    const p = [pend("Rua A", "111"), pend("Rua B", "222")];
    expect(
      pendenciasNaoResolvidas(p, [
        anexo("matricula", "manual"),
        anexo("matricula", "manual"),
      ])
    ).toEqual([]);
  });

  it("sem anexo nenhum, todas as pendências ficam de pé", () => {
    const p = [pend("Rua A"), pend("Rua B")];
    expect(pendenciasNaoResolvidas(p, [])).toEqual(p);
  });
});
