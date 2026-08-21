import { describe, it, expect } from "vitest";
import { matriculaConditionalPaths } from "@/lib/forms/party-required";
import { dadosContratoSchema } from "@/lib/forms/validation";
import {
  pendenciasDeMatricula,
  matriculaJaObtida,
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

describe("matriculaJaObtida — o que resolve a pendência", () => {
  it("anexo copiado DO FORMULÁRIO não resolve (foi ele que motivou o pedido)", () => {
    expect(matriculaJaObtida([{ category: "matricula", source: "form" }])).toBe(false);
  });

  it("upload manual do corretor resolve", () => {
    expect(matriculaJaObtida([{ category: "matricula", source: "manual" }])).toBe(true);
  });

  it("certidão emitida (ONR/Infosimples) resolve", () => {
    expect(
      matriculaJaObtida([{ category: "matricula", source: "infosimples" }])
    ).toBe(true);
  });

  it("categoria legada matricula_anexada também resolve", () => {
    expect(
      matriculaJaObtida([{ category: "matricula_anexada", source: "manual" }])
    ).toBe(true);
  });

  it("anexo de outra categoria não resolve", () => {
    expect(matriculaJaObtida([{ category: "iptu", source: "manual" }])).toBe(false);
  });
});
