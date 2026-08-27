import { describe, expect, it, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import type { ExtractedDoc, FichaResumoData } from "../extracted-to-form";
import {
  applyFichaResumoLocacao,
  mapExtractedToLocacaoForm,
  suggestLocacaoAssignment,
} from "../extracted-to-form-locacao";

/**
 * Stub de RHF por PATH (mesmo padrão de extracted-to-form-locacao.test.ts): o
 * código grava com `setValue("locadores.0.nome", …)`, então o store é plano.
 */
function makeFormStub(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const setValue = vi.fn((path: string, value: unknown) => store.set(path, value));
  const getValues = vi.fn((path?: string) => {
    if (path === undefined) {
      const out: Record<string, unknown> = {};
      store.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    }
    return store.get(path);
  });
  return {
    form: { setValue, getValues, clearErrors: vi.fn() } as unknown as UseFormReturn<
      Record<string, unknown>
    >,
    store,
  };
}

const FICHA: FichaResumoData = {
  partes: [
    {
      papel: "locador",
      indice_referencia: 0,
      nome: "Alexandre Souza",
      cpf: "390.281.740-05",
      profissao: "Engenheiro",
      nacionalidade: "Brasileiro",
      estado_civil: "Casado(a)",
      email: "alexandre@example.com",
      endereco: "Rua das Palmeiras",
      numero: "88",
      bairro: "Centro",
      cidade: "Piracicaba",
      uf: "sp",
      cep: "13400-000",
    },
    {
      papel: "conjuge_locador",
      indice_referencia: 0,
      nome: "Lucimara Souza",
      cpf: "153.509.460-06",
      profissao: "Professora",
    },
    {
      papel: "locatario",
      indice_referencia: 0,
      nome: "Felipe Lima",
      cpf: "875.157.400-06",
      profissao: "Vendedor",
    },
    {
      papel: "locatario",
      indice_referencia: 1,
      nome: "Vinicius Alves",
      cpf: "064.075.930-05",
    },
    {
      papel: "fiador",
      indice_referencia: 0,
      nome: "Paloma Reis",
      cpf: "279.011.720-01",
    },
    // Papel de VENDA numa ficha de locação: tem que ser ignorado.
    { papel: "vendedor", indice_referencia: 0, nome: "Ninguem" },
  ],
  imoveis: [
    {
      rua: "Avenida Independencia",
      numero: "1200",
      bairro: "Alemaes",
      cidade: "Piracicaba",
      uf: "SP",
      cep: "13416-000",
      matricula: "45678",
      cartorio: "1o RI de Piracicaba",
      descricao: "Apartamento de 2 dormitorios com 1 vaga",
    },
  ],
};

describe("applyFichaResumoLocacao", () => {
  it("preenche locadores, locatários e o cônjuge nos slots certos", () => {
    const { form, store } = makeFormStub();
    const filled = applyFichaResumoLocacao(FICHA, form);

    expect(filled).toBeGreaterThan(0);
    expect(store.get("locadores.0.nome")).toBe("Alexandre Souza");
    expect(store.get("locadores.0.cpf")).toBe("39028174005");
    expect(store.get("locadores.0.profissao")).toBe("Engenheiro");
    expect(store.get("locadores.0.uf")).toBe("SP");
    expect(store.get("locadores.0.conjuge.nome")).toBe("Lucimara Souza");
    expect(store.get("locadores.0.conjuge.profissao")).toBe("Professora");
    expect(store.get("locatarios.0.nome")).toBe("Felipe Lima");
    expect(store.get("locatarios.1.nome")).toBe("Vinicius Alves");
  });

  it("põe o fiador em garantia.fiador e liga a modalidade fiador", () => {
    const { form, store } = makeFormStub();
    applyFichaResumoLocacao(FICHA, form);

    expect(store.get("garantia.fiador.nome")).toBe("Paloma Reis");
    expect(store.get("garantia.fiador.cpf")).toBe("27901172001");
    expect(store.get("garantia.tipo")).toBe("fiador");
  });

  it("ignora papéis da esteira de venda", () => {
    const { form, store } = makeFormStub();
    applyFichaResumoLocacao(FICHA, form);

    expect(store.get("vendedores.0.nome")).toBeUndefined();
  });

  it("aplica só o primeiro imóvel (locação é um imóvel por contrato)", () => {
    const { form, store } = makeFormStub();
    applyFichaResumoLocacao(FICHA, form);

    expect(store.get("imovel.matricula")).toBe("45678");
    expect(store.get("imovel.rua")).toBe("Avenida Independencia");
    expect(store.get("imovel.numero")).toBe("1200");
    expect(String(store.get("imovel.descricao"))).toContain("2 dormitorios");
  });

  it("não sobrescreve o que já está preenchido", () => {
    const { form, store } = makeFormStub({
      "locadores.0.nome": "Nome digitado a mao",
      locadores: [{ tipo_pessoa: "fisica" }],
    });
    applyFichaResumoLocacao(FICHA, form);

    expect(store.get("locadores.0.nome")).toBe("Nome digitado a mao");
    expect(store.get("locadores.0.profissao")).toBe("Engenheiro");
  });
});

describe("suggestLocacaoAssignment — ficha e procuração", () => {
  const snapshot = {
    locadores: [{ nome: "Alexandre Souza", cpf: "39028174005" }],
    locatarios: [{ nome: "Felipe Lima", cpf: "87515740006" }],
  };

  it("usa o papel declarado na ficha para um RG avulso", () => {
    const rg: Record<string, unknown> = {
      nome_completo: "Paloma Reis",
      cpf_numero: "27901172001",
    };
    const assignment = suggestLocacaoAssignment("rg", rg, {}, [
      {
        category: "ficha_resumo",
        fields: FICHA as unknown as Record<string, unknown>,
        assignment: { kind: "outro", index: 0 },
      },
    ]);
    expect(assignment).toEqual({ kind: "fiador", index: 0 });
  });

  it("a própria ficha-resumo não é atribuída a ninguém", () => {
    expect(
      suggestLocacaoAssignment(
        "ficha_resumo",
        FICHA as unknown as Record<string, unknown>,
        {}
      )
    ).toEqual({ kind: "outro", index: 0 });
  });

  it("procuração vira representante da parte que é o outorgante", () => {
    const proc: Record<string, unknown> = {
      outorgante_nome: "Felipe Lima",
      outorgante_cpf: "87515740006",
      outorgado_nome: "Advogada Fulana",
      outorgado_cpf: "37822216082",
    };
    expect(suggestLocacaoAssignment("procuracao", proc, snapshot)).toEqual({
      kind: "representante_locatario",
      index: 0,
    });
  });

  it("procuração sem outorgante conhecido não inventa slot", () => {
    expect(
      suggestLocacaoAssignment(
        "procuracao",
        { outorgante_nome: "Desconhecido" },
        snapshot
      )
    ).toEqual({ kind: "outro", index: 0 });
  });
});

describe("mapExtractedToLocacaoForm — qualificação que era descartada", () => {
  it("certidão de casamento no titular preenche profissão e o cônjuge", () => {
    const { form, store } = makeFormStub({
      "locatarios.0.nome": "Felipe Lima",
      "locatarios.0.cpf": "87515740006",
    });
    const certidao: ExtractedDoc = {
      category: "certidao_casamento",
      fields: {
        conjuge1_nome: "Felipe Lima",
        conjuge1_cpf: "87515740006",
        conjuge1_profissao: "Vendedor",
        conjuge1_nacionalidade: "Brasileiro",
        conjuge2_nome: "Bianca Lima",
        conjuge2_cpf: "15350946006",
        conjuge2_profissao: "Dentista",
        regime_bens: "Comunhao parcial de bens",
      },
      confidence: 0.9,
    };

    mapExtractedToLocacaoForm(certidao, { kind: "locatario", index: 0 }, form);

    expect(store.get("locatarios.0.profissao")).toBe("Vendedor");
    expect(store.get("locatarios.0.nacionalidade")).toBe("Brasileiro");
    expect(store.get("locatarios.0.estado_civil")).toBe("Casado(a)");
    expect(store.get("locatarios.0.conjuge.nome")).toBe("Bianca Lima");
    expect(store.get("locatarios.0.conjuge.profissao")).toBe("Dentista");
  });

  it("procuração no titular preenche a qualificação do outorgante", () => {
    const { form, store } = makeFormStub();
    const proc: ExtractedDoc = {
      category: "procuracao",
      fields: {
        outorgante_nome: "Alexandre Souza",
        outorgante_cpf: "39028174005",
        outorgante_profissao: "Engenheiro",
        outorgante_nacionalidade: "Brasileiro",
        outorgante_estado_civil: "Casado(a)",
        outorgante_endereco_completo: "Rua das Palmeiras, 88",
      },
      confidence: 0.9,
    };

    mapExtractedToLocacaoForm(proc, { kind: "locador", index: 0 }, form);

    expect(store.get("locadores.0.nome")).toBe("Alexandre Souza");
    expect(store.get("locadores.0.profissao")).toBe("Engenheiro");
    expect(store.get("locadores.0.estado_civil")).toBe("Casado(a)");
    expect(store.get("locadores.0.endereco")).toBe("Rua das Palmeiras");
    expect(store.get("locadores.0.numero")).toBe("88");
  });
});
