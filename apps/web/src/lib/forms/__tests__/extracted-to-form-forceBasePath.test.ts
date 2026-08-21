import { describe, it, expect, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import {
  documentLabel,
  mapExtractedToForm,
  suggestAssignment,
  type ExtractedDoc,
  type Assignment,
} from "../extracted-to-form";

/**
 * Stub leve do UseFormReturn — só os métodos que mapExtractedToForm usa:
 * getValues(path) e setValue(path, value, opts). Backed por Map<string, unknown>.
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
  // O autofill limpa o erro do campo que acabou de preencher; sem este
  // mock o stub mentiria sobre a interface que o codigo usa.
  const clearErrors = vi.fn();
  return {
    form: { setValue, getValues, clearErrors } as unknown as UseFormReturn<
      Record<string, unknown>
    >,
    store,
    setValueCalls: setValue,
  };
}

const RG_EXTRACTION: ExtractedDoc = {
  category: "rg",
  fields: {
    nome_completo: "João Silva",
    cpf_numero: "12345678901",
    rg_numero: "1234567",
  },
};

describe("mapExtractedToForm — forceBasePath", () => {
  it("forceBasePath='vendedores.0' aplica em vendedores mesmo com assignment.kind='comprador'", () => {
    const { form, store } = makeFormStub();
    const assignment: Assignment = { kind: "comprador", index: 0 };

    const filled = mapExtractedToForm(RG_EXTRACTION, assignment, form, {
      forceBasePath: "vendedores.0",
    });

    expect(filled).toBeGreaterThan(0);
    expect(store.get("vendedores.0.nome")).toBe("João Silva");
    expect(store.get("vendedores.0.cpf")).toBe("12345678901");
    expect(store.get("vendedores.0.rg")).toBe("1234567");
    // Critério essencial: NÃO escreveu em compradores.0.*
    expect(store.get("compradores.0.nome")).toBeUndefined();
    expect(store.get("compradores.0.cpf")).toBeUndefined();
  });

  it("forceBasePath='imoveis.0' aplica em imoveis mesmo se kind for pessoa", () => {
    const { form, store } = makeFormStub();
    const assignment: Assignment = { kind: "vendedor", index: 0 };

    // Matrícula vai pra imoveis. Usa categoria "matricula" pra o helper
    // entender que é property.
    const matriculaExtraction: ExtractedDoc = {
      category: "matricula",
      fields: {
        rua: "Av Augusta",
        cidade: "São Paulo",
        matricula_numero: "12345",
      },
    };

    mapExtractedToForm(matriculaExtraction, assignment, form, {
      forceBasePath: "imoveis.0",
    });

    // Pelo menos um campo foi aplicado em imoveis.0
    let foundAny = false;
    store.forEach((_v, k) => {
      if (k.startsWith("imoveis.0.")) foundAny = true;
    });
    expect(foundAny).toBe(true);
    // E nada em vendedores.0
    let foundInVendedor = false;
    store.forEach((_v, k) => {
      if (k.startsWith("vendedores.0.")) foundInVendedor = true;
    });
    expect(foundInVendedor).toBe(false);
  });

  it("sem forceBasePath preserva comportamento legado (basePath via assignment)", () => {
    const { form, store } = makeFormStub();
    const assignment: Assignment = { kind: "comprador", index: 0 };

    mapExtractedToForm(RG_EXTRACTION, assignment, form, {});

    // Sem forceBasePath, basePath = compradores.0
    expect(store.get("compradores.0.nome")).toBe("João Silva");
    expect(store.get("vendedores.0.nome")).toBeUndefined();
  });

  it("forceBasePath + skipIfDirty=true não sobrescreve valor existente", () => {
    const { form, store } = makeFormStub({
      "vendedores.0.nome": "Nome Já Preenchido",
    });
    const assignment: Assignment = { kind: "comprador", index: 0 };

    mapExtractedToForm(RG_EXTRACTION, assignment, form, {
      forceBasePath: "vendedores.0",
      skipIfDirty: true,
    });

    // Mantém o valor original — não sobrescreve.
    expect(store.get("vendedores.0.nome")).toBe("Nome Já Preenchido");
    // Campos vazios em vendedores foram preenchidos
    expect(store.get("vendedores.0.cpf")).toBe("12345678901");
    expect(store.get("vendedores.0.rg")).toBe("1234567");
  });
});

// ============================================================================
// Doc pessoal FORA do catálogo do classificador (bug de prod: carteira da OAB
// classificada como "outro" — o gate por categoria descartava tudo e o
// "Aplicar aos campos" preenchia zero campos silenciosamente).
// ============================================================================

/** Payload real do OCR (Gemini) numa carteira da OAB, confidence 0.98. */
const OAB_EXTRACTION: ExtractedDoc = {
  category: "outro",
  fields: {
    tipo_documento: "Identidade de Advogado",
    nome_completo: "Ana Paula Advogada",
    cpf_numero: "111.222.333-44",
    rg_numero: "MG-12.345.678",
    data_nascimento: "1985-03-12",
    naturalidade: "Belo Horizonte",
    filiacao_mae: "Maria Advogada",
    numero_inscricao: "OAB/MG 123456",
  },
  confidence: 0.98,
};

describe("mapExtractedToForm — categoria fora do catálogo (evidência de identidade)", () => {
  it('category "outro" com campos de identidade aplica no slot de PESSOA', () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToForm(
      OAB_EXTRACTION,
      { kind: "vendedor", index: 0 },
      form
    );

    expect(filled).toBeGreaterThan(0);
    expect(store.get("vendedores.0.nome")).toBe("Ana Paula Advogada");
    expect(store.get("vendedores.0.cpf")).toBe("11122233344");
    expect(store.get("vendedores.0.rg")).toBe("MG-12.345.678");
    expect(store.get("vendedores.0.data_nascimento")).toBe("1985-03-12");
    expect(store.get("vendedores.0.naturalidade")).toBe("Belo Horizonte");
    expect(store.get("vendedores.0.nome_mae")).toBe("Maria Advogada");
  });

  it('"outro" também vale pra cônjuge e representante (slots de pessoa)', () => {
    const { form, store } = makeFormStub();
    expect(
      mapExtractedToForm(OAB_EXTRACTION, { kind: "conjuge_comprador", index: 1 }, form, {
        // Sem a flag explicitamente false, endereço do cônjuge é pulado — aqui
        // o doc não tem endereço, então não muda nada.
      })
    ).toBeGreaterThan(0);
    expect(store.get("compradores.1.conjuge.nome")).toBe("Ana Paula Advogada");

    const rep = makeFormStub();
    expect(
      mapExtractedToForm(
        OAB_EXTRACTION,
        { kind: "representante_vendedor", index: 0 },
        rep.form
      )
    ).toBeGreaterThan(0);
    expect(rep.store.get("vendedores.0.representante.cpf")).toBe("11122233344");
  });

  it('"outro" SEM campos de identidade continua aplicando 0 campos', () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToForm(
      {
        category: "outro",
        fields: {
          tipo_documento: "Comprovante de pagamento",
          valor: "R$ 1.200,00",
          cidade: "Campinas",
        },
      },
      { kind: "vendedor", index: 0 },
      form
    );
    expect(filled).toBe(0);
    expect(store.size).toBe(0);
  });

  it('"outro" com assignment de IMÓVEL continua aplicando 0 campos (whitelist)', () => {
    const { form, store } = makeFormStub();
    const filled = mapExtractedToForm(
      OAB_EXTRACTION,
      { kind: "imovel", index: 0 },
      form
    );
    expect(filled).toBe(0);
    expect(store.size).toBe(0);
  });

  it("respeita skipIfDirty como qualquer outra categoria", () => {
    const { form, store } = makeFormStub({ "vendedores.0.nome": "Digitado À Mão" });
    mapExtractedToForm(OAB_EXTRACTION, { kind: "vendedor", index: 0 }, form);
    expect(store.get("vendedores.0.nome")).toBe("Digitado À Mão");
    expect(store.get("vendedores.0.cpf")).toBe("11122233344");
  });
});

describe("suggestAssignment — categoria fora do catálogo", () => {
  const snapshot = {
    vendedores: [
      { tipo_pessoa: "fisica", nome: "Ana Paula Advogada", cpf: "11122233344" },
    ],
    compradores: [{ tipo_pessoa: "fisica", nome: "Carlos Comprador", cpf: "99988877766" }],
    imoveis: [],
  };

  it('"outro" com CPF que casa com parte existente sugere a parte', () => {
    expect(suggestAssignment("outro", OAB_EXTRACTION.fields, snapshot)).toEqual({
      kind: "vendedor",
      index: 0,
    });
  });

  it('"outro" com nome que casa com comprador sugere o comprador', () => {
    expect(
      suggestAssignment(
        "outro",
        { tipo_documento: "Carteira funcional", nome_completo: "carlos comprador" },
        snapshot
      )
    ).toEqual({ kind: "comprador", index: 0 });
  });

  it('"outro" sem evidência de identidade continua em "outro"', () => {
    expect(
      suggestAssignment("outro", { tipo_documento: "Boleto", valor: "R$ 10" }, snapshot)
    ).toEqual({ kind: "outro", index: 0 });
  });

  it("ficha_resumo nunca é tratada como doc pessoal (tem fluxo próprio)", () => {
    expect(
      suggestAssignment(
        "ficha_resumo",
        { nome_completo: "Ana Paula Advogada", partes: [] },
        snapshot
      )
    ).toEqual({ kind: "outro", index: 0 });
  });
});

describe("documentLabel", () => {
  it('usa tipo_documento quando a categoria é "outro"', () => {
    expect(documentLabel("outro", OAB_EXTRACTION.fields)).toBe(
      "Identidade de Advogado"
    );
  });

  it('cai em "Outro" sem tipo_documento e preserva as categorias conhecidas', () => {
    expect(documentLabel("outro", { valor: "R$ 10" })).toBe("Outro");
    expect(documentLabel("outro", null)).toBe("Outro");
    expect(documentLabel("rg", { tipo_documento: "Qualquer" })).toBe("RG");
  });
});
