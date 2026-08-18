import { describe, expect, it, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import type { Assignment, ExtractedDoc } from "../extracted-to-form";
import {
  mapExtractedToLocacaoForm,
  resolveLocacaoBasePath,
  suggestLocacaoAssignment,
} from "../extracted-to-form-locacao";
import {
  LOCACAO_STEP_LABELS,
  LOCACAO_COMERCIAL_STEP_LABELS,
} from "../validation-locacao";

function makeFormStub(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const setValue = vi.fn((path: string, value: unknown) => {
    store.set(path, value);
  });
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
    form: { setValue, getValues } as unknown as UseFormReturn<Record<string, unknown>>,
    store,
  };
}

const RG_EXTRACTION: ExtractedDoc = {
  category: "rg",
  fields: {
    nome_completo: "Maria Locatária",
    cpf_numero: "98765432100",
    rg_numero: "7654321",
  },
};

const MATRICULA_EXTRACTION: ExtractedDoc = {
  category: "matricula",
  fields: {
    matricula_numero: "12345",
    cartorio: "2º RI de Campinas",
    endereco_completo: "Rua das Flores, 100",
    area_total: "75,5",
  },
};

describe("resolveLocacaoBasePath", () => {
  it("partes indexadas, fiador e imóvel sem índice", () => {
    expect(resolveLocacaoBasePath({ kind: "locador", index: 1 })).toBe("locadores.1");
    expect(resolveLocacaoBasePath({ kind: "locatario", index: 0 })).toBe("locatarios.0");
    expect(resolveLocacaoBasePath({ kind: "fiador", index: 0 })).toBe("garantia.fiador");
    expect(resolveLocacaoBasePath({ kind: "representante_locador", index: 2 })).toBe(
      "locadores.2.representante"
    );
    expect(resolveLocacaoBasePath({ kind: "imovel", index: 0 })).toBe("imovel");
    expect(resolveLocacaoBasePath({ kind: "outro", index: 0 })).toBeNull();
  });

  it("cônjuges (2026-07-31): indexados nas partes, sem índice no fiador", () => {
    expect(resolveLocacaoBasePath({ kind: "conjuge_locador", index: 1 })).toBe(
      "locadores.1.conjuge"
    );
    expect(resolveLocacaoBasePath({ kind: "conjuge_locatario", index: 0 })).toBe(
      "locatarios.0.conjuge"
    );
    expect(resolveLocacaoBasePath({ kind: "conjuge_fiador", index: 0 })).toBe(
      "garantia.fiador.conjuge"
    );
  });
});

describe("mapExtractedToLocacaoForm", () => {
  it("RG do locatário aplica em locatarios.{i}", () => {
    const { form, store } = makeFormStub();
    const assignment: Assignment = { kind: "locatario", index: 0 };
    const filled = mapExtractedToLocacaoForm(RG_EXTRACTION, assignment, form);
    expect(filled).toBeGreaterThan(0);
    expect(store.get("locatarios.0.nome")).toBe("Maria Locatária");
    expect(store.get("locatarios.0.cpf")).toBe("98765432100");
    expect(store.get("locatarios.0.rg")).toBe("7654321");
  });

  it("RG do fiador aplica em garantia.fiador (sem índice)", () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToLocacaoForm(
      RG_EXTRACTION,
      { kind: "fiador", index: 0 },
      form
    );
    expect(filled).toBeGreaterThan(0);
    expect(store.get("garantia.fiador.nome")).toBe("Maria Locatária");
  });

  it("matrícula aplica no imovel singular, área vira number", () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToLocacaoForm(
      MATRICULA_EXTRACTION,
      { kind: "imovel", index: 0 },
      form
    );
    expect(filled).toBeGreaterThan(0);
    expect(store.get("imovel.matricula")).toBe("12345");
    expect(store.get("imovel.cartorio")).toBe("2º RI de Campinas");
    expect(store.get("imovel.rua")).toBe("Rua das Flores");
    expect(store.get("imovel.numero")).toBe("100");
    expect(store.get("imovel.area")).toBe(75.5);
  });

  it("RG do cônjuge do locador preenche o subobjeto + estado civil do pai (D2)", () => {
    const { form, store } = makeFormStub({ "locadores.0.nome": "João Locador" });
    const filled = mapExtractedToLocacaoForm(
      RG_EXTRACTION,
      { kind: "conjuge_locador", index: 0 },
      form
    );
    expect(filled).toBeGreaterThan(0);
    expect(store.get("locadores.0.conjuge.nome")).toBe("Maria Locatária");
    expect(store.get("locadores.0.conjuge.cpf")).toBe("98765432100");
    expect(store.get("locadores.0.estado_civil")).toBe("Casado(a)");
  });

  it("certidão de casamento no cônjuge do fiador escolhe o nubente certo (D1)", () => {
    const { form, store } = makeFormStub({
      "garantia.fiador.nome": "Pedro Fiador",
      "garantia.fiador.cpf": "55566677788",
    });
    mapExtractedToLocacaoForm(
      {
        category: "certidao_casamento",
        fields: {
          conjuge1_nome: "Pedro Fiador",
          conjuge1_cpf: "555.666.777-88",
          conjuge2_nome: "Clara Fiadora",
          conjuge2_cpf: "444.333.222-11",
        },
      },
      { kind: "conjuge_fiador", index: 0 },
      form
    );
    expect(store.get("garantia.fiador.conjuge.nome")).toBe("Clara Fiadora");
    expect(store.get("garantia.fiador.conjuge.cpf")).toBe("44433322211");
    expect(store.get("garantia.fiador.estado_civil")).toBe("Casado(a)");
  });

  it("representante de locação só recebe nome/cpf (schema não tem o resto)", () => {
    const { form, store } = makeFormStub();
    mapExtractedToLocacaoForm(
      RG_EXTRACTION,
      { kind: "representante_locatario", index: 0 },
      form
    );
    expect(store.get("locatarios.0.representante.nome")).toBe("Maria Locatária");
    expect(store.get("locatarios.0.representante.cpf")).toBe("98765432100");
    expect(store.get("locatarios.0.representante.rg")).toBeUndefined();
  });

  it("skipIfDirty preserva campo já preenchido", () => {
    const { form, store } = makeFormStub({ "locatarios.0.nome": "Nome Digitado" });
    mapExtractedToLocacaoForm(RG_EXTRACTION, { kind: "locatario", index: 0 }, form);
    expect(store.get("locatarios.0.nome")).toBe("Nome Digitado");
    // CPF estava vazio → aplica
    expect(store.get("locatarios.0.cpf")).toBe("98765432100");
  });
});

describe("suggestLocacaoAssignment", () => {
  const snapshot = {
    locadores: [{ tipo_pessoa: "fisica", nome: "João Locador", cpf: "11122233344" }],
    locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária", cpf: "98765432100" }],
    garantia: {
      tipo: "fiador",
      fiador: { tipo_pessoa: "fisica", nome: "Pedro Fiador", cpf: "55566677788" },
    },
  };

  it("match por CPF em locatários", () => {
    expect(
      suggestLocacaoAssignment("rg", { cpf_numero: "987.654.321-00" }, snapshot)
    ).toEqual({ kind: "locatario", index: 0 });
  });

  it("match por nome em locadores", () => {
    expect(
      suggestLocacaoAssignment("cnh", { nome_completo: "joão locador" }, snapshot)
    ).toEqual({ kind: "locador", index: 0 });
  });

  it("match do fiador via garantia.fiador", () => {
    expect(
      suggestLocacaoAssignment("rg", { cpf_numero: "55566677788" }, snapshot)
    ).toEqual({ kind: "fiador", index: 0 });
  });

  it("match do cônjuge cadastrado em locadores → conjuge_locador", () => {
    expect(
      suggestLocacaoAssignment(
        "rg",
        { cpf_numero: "22233344455" },
        {
          ...snapshot,
          locadores: [
            {
              ...snapshot.locadores[0],
              conjuge: { nome: "Joana Locadora", cpf: "22233344455" },
            },
          ],
        }
      )
    ).toEqual({ kind: "conjuge_locador", index: 0 });
  });

  it("match do cônjuge do fiador → conjuge_fiador (sem índice)", () => {
    expect(
      suggestLocacaoAssignment(
        "certidao_casamento",
        { nome_completo: "clara fiadora" },
        {
          ...snapshot,
          garantia: {
            tipo: "fiador",
            fiador: {
              ...snapshot.garantia.fiador,
              conjuge: { nome: "Clara Fiadora" },
            },
          },
        }
      )
    ).toEqual({ kind: "conjuge_fiador", index: 0 });
  });

  it("doc de imóvel sempre vai pro imovel", () => {
    expect(suggestLocacaoAssignment("matricula", {}, snapshot)).toEqual({
      kind: "imovel",
      index: 0,
    });
  });

  it("pessoa desconhecida cai em outro", () => {
    expect(
      suggestLocacaoAssignment("rg", { cpf_numero: "00099988877" }, snapshot)
    ).toEqual({ kind: "outro", index: 0 });
  });

  it('"outro" com CPF que casa com locador sugere o locador', () => {
    expect(
      suggestLocacaoAssignment("outro", OAB_EXTRACTION.fields, snapshot)
    ).toEqual({ kind: "locador", index: 0 });
  });

  it('"outro" sem evidência de identidade continua em "outro"', () => {
    expect(
      suggestLocacaoAssignment(
        "outro",
        { tipo_documento: "Boleto", valor: "R$ 10" },
        snapshot
      )
    ).toEqual({ kind: "outro", index: 0 });
  });
});

// ============================================================================
// Doc pessoal FORA do catálogo do classificador (bug de prod: carteira da OAB
// veio como "outro" e o "Aplicar aos campos" preenchia zero).
// ============================================================================

const OAB_EXTRACTION: ExtractedDoc = {
  category: "outro",
  fields: {
    tipo_documento: "Identidade de Advogado",
    nome_completo: "João Locador",
    cpf_numero: "111.222.333-44",
    rg_numero: "MG-12.345.678",
    data_nascimento: "1985-03-12",
    naturalidade: "Belo Horizonte",
    filiacao_mae: "Maria Locadora",
    numero_inscricao: "OAB/MG 123456",
  },
  confidence: 0.98,
};

describe("mapExtractedToLocacaoForm — categoria fora do catálogo", () => {
  it('"outro" com identidade aplica no slot de pessoa (locador)', () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToLocacaoForm(
      OAB_EXTRACTION,
      { kind: "locador", index: 0 },
      form
    );
    expect(filled).toBeGreaterThan(0);
    expect(store.get("locadores.0.nome")).toBe("João Locador");
    expect(store.get("locadores.0.cpf")).toBe("11122233344");
    expect(store.get("locadores.0.rg")).toBe("MG-12.345.678");
    expect(store.get("locadores.0.data_nascimento")).toBe("1985-03-12");
    // parteLocacaoSchema não tem naturalidade/nome_mae — não injeta chave órfã.
    expect(store.get("locadores.0.naturalidade")).toBeUndefined();
    expect(store.get("locadores.0.nome_mae")).toBeUndefined();
  });

  it('"outro" com identidade também vale pro fiador', () => {
    const { form, store } = makeFormStub();
    expect(
      mapExtractedToLocacaoForm(OAB_EXTRACTION, { kind: "fiador", index: 0 }, form)
    ).toBeGreaterThan(0);
    expect(store.get("garantia.fiador.nome")).toBe("João Locador");
  });

  it('"outro" SEM campos de identidade continua aplicando 0 campos', () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToLocacaoForm(
      {
        category: "outro",
        fields: { tipo_documento: "Comprovante", valor: "R$ 1.200,00", cidade: "Campinas" },
      },
      { kind: "locador", index: 0 },
      form
    );
    expect(filled).toBe(0);
    expect(store.size).toBe(0);
  });

  it('"outro" com assignment de IMÓVEL continua aplicando 0 campos', () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToLocacaoForm(
      OAB_EXTRACTION,
      { kind: "imovel", index: 0 },
      form
    );
    expect(filled).toBe(0);
    expect(store.size).toBe(0);
  });

  it("respeita skipIfDirty", () => {
    const { form, store } = makeFormStub({ "locadores.0.nome": "Digitado À Mão" });
    mapExtractedToLocacaoForm(OAB_EXTRACTION, { kind: "locador", index: 0 }, form);
    expect(store.get("locadores.0.nome")).toBe("Digitado À Mão");
    expect(store.get("locadores.0.cpf")).toBe("11122233344");
  });
});

describe("labels do wizard de locação", () => {
  it("etapa 0 é Documentos nas duas finalidades (6 etapas)", () => {
    expect(LOCACAO_STEP_LABELS[0]).toBe("Documentos");
    expect(LOCACAO_COMERCIAL_STEP_LABELS[0]).toBe("Documentos");
    expect(LOCACAO_STEP_LABELS).toHaveLength(6);
    expect(LOCACAO_COMERCIAL_STEP_LABELS).toHaveLength(6);
    // Guard do index-shift do wizard: partes em 1-2, imóvel em 3, aluguel em 4.
    expect(LOCACAO_STEP_LABELS[1]).toBe("Locador(es)");
    expect(LOCACAO_STEP_LABELS[2]).toBe("Locatário(s)");
    expect(LOCACAO_STEP_LABELS[3]).toBe("Imóvel");
    expect(LOCACAO_STEP_LABELS[4]).toBe("Aluguel e Reajuste");
  });

  it("a Garantia é a última etapa (a Confirmação saiu em 2026-07-30; observações entraram em 2026-08)", () => {
    expect(LOCACAO_STEP_LABELS[5]).toBe("Garantia e Observações");
    expect(LOCACAO_COMERCIAL_STEP_LABELS[5]).toBe("Garantia e Observações");
    expect(LOCACAO_STEP_LABELS).not.toContain("Confirmação e Assinatura");
    expect(LOCACAO_COMERCIAL_STEP_LABELS).not.toContain("Confirmação e Assinatura");
  });
});
