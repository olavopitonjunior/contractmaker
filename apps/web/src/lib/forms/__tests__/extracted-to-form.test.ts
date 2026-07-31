import { describe, expect, it, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import {
  mapExtractedToForm,
  pickSpouseFromCertidao,
  resolveBasePath,
  suggestAssignment,
  type Assignment,
  type ExtractedDoc,
} from "../extracted-to-form";

/**
 * Núcleo do autofill de VENDA. Cobre o que a revisão de 2026-07-31 acrescentou
 * (sub-slots cônjuge/procurador/representante, certidão de casamento e
 * procuração como fontes de campo) sem quebrar os ramos históricos.
 *
 * Form stub: mapa plano path → valor, igual ao usado em
 * extracted-to-form-locacao.test.ts.
 */
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

const RG: ExtractedDoc = {
  category: "rg",
  fields: {
    nome_completo: "Ana Cônjuge",
    cpf_numero: "111.222.333-44",
    rg_numero: "MG-1234567",
    filiacao_mae: "Mãe da Ana",
    data_nascimento: "1980-01-02",
    naturalidade: "Belo Horizonte",
    sexo: "F",
    bairro: "Centro",
    cidade: "Campinas",
    uf: "SP",
    cep: "13010-000",
    endereco_completo: "Rua das Acácias, 45",
  },
};

const PROCURACAO: ExtractedDoc = {
  category: "procuracao",
  fields: {
    outorgante_nome: "João Vendedor",
    outorgante_cpf: "555.666.777-88",
    outorgado_nome: "Carlos Procurador",
    outorgado_cpf: "999.888.777-66",
  },
};

const CERTIDAO: ExtractedDoc = {
  category: "certidao_casamento",
  fields: {
    conjuge1_nome: "João Vendedor",
    conjuge1_cpf: "555.666.777-88",
    conjuge2_nome: "Ana Cônjuge",
    conjuge2_cpf: "111.222.333-44",
    regime_bens: "Comunhão parcial de bens",
  },
};

describe("resolveBasePath", () => {
  it("titulares, sub-slots e imóvel", () => {
    expect(resolveBasePath({ kind: "vendedor", index: 1 })).toBe("vendedores.1");
    expect(resolveBasePath({ kind: "conjuge_comprador", index: 0 })).toBe(
      "compradores.0.conjuge"
    );
    expect(resolveBasePath({ kind: "representante_vendedor", index: 2 })).toBe(
      "vendedores.2.representante"
    );
    expect(resolveBasePath({ kind: "procurador_vendedor", index: 0 })).toBe(
      "vendedores.0.procurador"
    );
    expect(resolveBasePath({ kind: "procurador_comprador", index: 3 })).toBe(
      "compradores.3.procurador"
    );
    expect(resolveBasePath({ kind: "imovel", index: 0 })).toBe("imoveis.0");
    expect(resolveBasePath({ kind: "outro", index: 0 })).toBeNull();
  });
});

describe("mapExtractedToForm — cônjuge (kind conjuge_*)", () => {
  it("RG do cônjuge preenche o subobjeto e liga o estado civil do pai (D2)", () => {
    const { form, store } = makeFormStub({ "vendedores.0.nome": "João Vendedor" });
    const filled = mapExtractedToForm(RG, { kind: "conjuge_vendedor", index: 0 }, form);
    expect(filled).toBeGreaterThan(0);
    expect(store.get("vendedores.0.conjuge.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.conjuge.cpf")).toBe("11122233344");
    expect(store.get("vendedores.0.conjuge.rg")).toBe("MG-1234567");
    // D2 — sem isto a UI do cônjuge nem renderiza.
    expect(store.get("vendedores.0.estado_civil")).toBe("Casado(a)");
    // Endereço fica com o titular (endereco_igual_ao_titular default true).
    expect(store.get("vendedores.0.conjuge.cidade")).toBeUndefined();
    expect(store.get("vendedores.0.conjuge.endereco")).toBeUndefined();
  });

  it("D2 NÃO sobrescreve estado civil já preenchido", () => {
    const { form, store } = makeFormStub({
      "vendedores.0.estado_civil": "União Estável",
    });
    mapExtractedToForm(RG, { kind: "conjuge_vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.estado_civil")).toBe("União Estável");
  });

  it("cônjuge com endereço próprio (flag false) recebe o endereço", () => {
    const { form, store } = makeFormStub({
      "compradores.0.conjuge.endereco_igual_ao_titular": false,
    });
    mapExtractedToForm(RG, { kind: "conjuge_comprador", index: 0 }, form);
    expect(store.get("compradores.0.conjuge.cidade")).toBe("Campinas");
    expect(store.get("compradores.0.conjuge.endereco")).toBe("Rua das Acácias");
    expect(store.get("compradores.0.conjuge.numero")).toBe("45");
  });
});

describe("mapExtractedToForm — allowlist dos sub-slots (chaves órfãs)", () => {
  it("representante não recebe endereço (o schema da PJ não tem)", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(RG, { kind: "representante_vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.representante.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.representante.nome_mae")).toBe("Mãe da Ana");
    for (const orphan of ["endereco", "numero", "bairro", "cidade", "uf", "cep"]) {
      expect(store.get(`vendedores.0.representante.${orphan}`)).toBeUndefined();
    }
  });

  it("procurador recebe endereço mas não nome_mae/data_nascimento/naturalidade", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(RG, { kind: "procurador_vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.procurador.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.procurador.cpf")).toBe("11122233344");
    expect(store.get("vendedores.0.procurador.rg")).toBe("MG-1234567");
    expect(store.get("vendedores.0.procurador.sexo")).toBe("F");
    expect(store.get("vendedores.0.procurador.endereco")).toBe("Rua das Acácias");
    expect(store.get("vendedores.0.procurador.numero")).toBe("45");
    expect(store.get("vendedores.0.procurador.cidade")).toBe("Campinas");
    expect(store.get("vendedores.0.procurador.uf")).toBe("SP");
    for (const orphan of ["nome_mae", "data_nascimento", "naturalidade", "cep", "bairro"]) {
      expect(store.get(`vendedores.0.procurador.${orphan}`)).toBeUndefined();
    }
    // D3 — a atribuição é intenção explícita de que existe procurador.
    expect(store.get("vendedores.0.tem_procurador")).toBe(true);
  });
});

describe("mapExtractedToForm — procuração", () => {
  it("no slot do procurador aplica o OUTORGADO + liga tem_procurador (D3)", () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToForm(
      PROCURACAO,
      { kind: "procurador_vendedor", index: 0 },
      form
    );
    // nome + cpf + tem_procurador
    expect(filled).toBe(3);
    expect(store.get("vendedores.0.procurador.nome")).toBe("Carlos Procurador");
    expect(store.get("vendedores.0.procurador.cpf")).toBe("99988877766");
    expect(store.get("vendedores.0.tem_procurador")).toBe(true);
  });

  it("tem_procurador já true não conta em filled", () => {
    const { form } = makeFormStub({ "vendedores.0.tem_procurador": true });
    const filled = mapExtractedToForm(
      PROCURACAO,
      { kind: "procurador_vendedor", index: 0 },
      form
    );
    expect(filled).toBe(2);
  });

  it("no slot do representante aplica o OUTORGADO (D4)", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(PROCURACAO, { kind: "representante_comprador", index: 1 }, form);
    expect(store.get("compradores.1.representante.nome")).toBe("Carlos Procurador");
    expect(store.get("compradores.1.representante.cpf")).toBe("99988877766");
    // Não liga tem_procurador de um representante.
    expect(store.get("compradores.1.tem_procurador")).toBeUndefined();
  });

  it("no slot do titular aplica o OUTORGANTE (D5) — antes era no-op", () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToForm(PROCURACAO, { kind: "vendedor", index: 0 }, form);
    expect(filled).toBe(2);
    expect(store.get("vendedores.0.nome")).toBe("João Vendedor");
    expect(store.get("vendedores.0.cpf")).toBe("55566677788");
  });

  it("skipIfDirty protege o titular já digitado", () => {
    const { form, store } = makeFormStub({ "vendedores.0.nome": "Nome Digitado" });
    mapExtractedToForm(PROCURACAO, { kind: "vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.nome")).toBe("Nome Digitado");
    expect(store.get("vendedores.0.cpf")).toBe("55566677788");
  });
});

describe("pickSpouseFromCertidao (D1)", () => {
  const fields = CERTIDAO.fields;

  it("titular = conjuge1 (por CPF) → cônjuge é conjuge2", () => {
    expect(pickSpouseFromCertidao(fields, { cpf: "555.666.777-88" })).toEqual({
      nome: "Ana Cônjuge",
      cpf: "11122233344",
    });
  });

  it("titular = conjuge2 (por CPF) → cônjuge é conjuge1", () => {
    expect(pickSpouseFromCertidao(fields, { cpf: "11122233344" })).toEqual({
      nome: "João Vendedor",
      cpf: "55566677788",
    });
  });

  it("sem CPF, desempata por nome normalizado (acentos/caixa)", () => {
    expect(pickSpouseFromCertidao(fields, { nome: "ana conjuge" })).toEqual({
      nome: "João Vendedor",
      cpf: "55566677788",
    });
  });

  it("sem match cai em conjuge2 (convenção do ramo histórico)", () => {
    expect(pickSpouseFromCertidao(fields, null)).toEqual({
      nome: "Ana Cônjuge",
      cpf: "11122233344",
    });
    expect(pickSpouseFromCertidao(fields, { nome: "Outra Pessoa" })).toEqual({
      nome: "Ana Cônjuge",
      cpf: "11122233344",
    });
  });
});

describe("mapExtractedToForm — certidão de casamento", () => {
  it("atribuída ao cônjuge: escolhe o nubente certo e liga o estado civil do pai", () => {
    const { form, store } = makeFormStub({
      "vendedores.0.nome": "João Vendedor",
      "vendedores.0.cpf": "55566677788",
    });
    mapExtractedToForm(CERTIDAO, { kind: "conjuge_vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.conjuge.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.conjuge.cpf")).toBe("11122233344");
    // Regime informado → prefere o inferido ao "Casado(a)" genérico.
    expect(store.get("vendedores.0.estado_civil")).toBe("Casado(a)");
  });

  it("quando o titular é o conjuge2, o cônjuge vira o conjuge1", () => {
    const { form, store } = makeFormStub({
      "compradores.0.cpf": "11122233344",
    });
    mapExtractedToForm(CERTIDAO, { kind: "conjuge_comprador", index: 0 }, form);
    expect(store.get("compradores.0.conjuge.nome")).toBe("João Vendedor");
    expect(store.get("compradores.0.conjuge.cpf")).toBe("55566677788");
  });

  it("regressão: atribuída ao TITULAR segue preenchendo o cônjuge embutido", () => {
    const { form, store } = makeFormStub();
    mapExtractedToForm(CERTIDAO, { kind: "vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.estado_civil")).toBe("Casado(a)");
    expect(store.get("vendedores.0.conjuge.nome")).toBe("Ana Cônjuge");
    expect(store.get("vendedores.0.conjuge.cpf")).toBe("11122233344");
  });
});

// ============================================================================
// suggestAssignment — os matches de sub-slot não tinham cobertura nenhuma.
// ============================================================================

describe("suggestAssignment — sub-slots", () => {
  const snapshot = {
    vendedores: [
      {
        tipo_pessoa: "fisica",
        nome: "João Vendedor",
        cpf: "55566677788",
        conjuge: { nome: "Ana Cônjuge", cpf: "11122233344" },
        procurador: { nome: "Carlos Procurador", cpf: "99988877766" },
      },
    ],
    compradores: [
      {
        tipo_pessoa: "juridica",
        razao_social: "Imob LTDA",
        cnpj: "11222333000181",
        representante: { nome: "Rita Representante", cpf: "12345678909" },
      },
    ],
  };

  it("CPF do cônjuge cadastrado → conjuge_vendedor", () => {
    expect(
      suggestAssignment("rg", { cpf_numero: "111.222.333-44" }, snapshot)
    ).toEqual({ kind: "conjuge_vendedor", index: 0 });
  });

  it("nome do representante da PJ → representante_comprador", () => {
    expect(
      suggestAssignment("cnh", { nome_completo: "rita representante" }, snapshot)
    ).toEqual({ kind: "representante_comprador", index: 0 });
  });

  it("CPF do procurador cadastrado → procurador_vendedor", () => {
    expect(
      suggestAssignment("rg", { cpf_numero: "99988877766" }, snapshot)
    ).toEqual({ kind: "procurador_vendedor", index: 0 });
  });

  it("procuração casa o OUTORGANTE contra o titular e sugere o procurador dele", () => {
    expect(suggestAssignment("procuracao", PROCURACAO.fields, snapshot)).toEqual({
      kind: "procurador_vendedor",
      index: 0,
    });
  });

  it("procuração de outorgante desconhecido casa pelo OUTORGADO já cadastrado", () => {
    expect(
      suggestAssignment(
        "procuracao",
        { outorgante_nome: "Ninguém", outorgado_cpf: "99988877766" },
        snapshot
      )
    ).toEqual({ kind: "procurador_vendedor", index: 0 });
  });

  it("procuração sem nenhum match cai em outro", () => {
    expect(
      suggestAssignment(
        "procuracao",
        { outorgante_nome: "Ninguém", outorgado_nome: "Outro Alguém" },
        snapshot
      )
    ).toEqual({ kind: "outro", index: 0 });
  });

  it("titular ainda tem prioridade sobre os sub-slots", () => {
    expect(
      suggestAssignment("rg", { cpf_numero: "55566677788" }, snapshot)
    ).toEqual({ kind: "vendedor", index: 0 });
  });
});
