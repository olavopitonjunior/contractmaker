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
});

describe("labels do wizard de locação", () => {
  it("etapa 0 é Documentos nas duas finalidades (7 etapas)", () => {
    expect(LOCACAO_STEP_LABELS[0]).toBe("Documentos");
    expect(LOCACAO_COMERCIAL_STEP_LABELS[0]).toBe("Documentos");
    expect(LOCACAO_STEP_LABELS).toHaveLength(7);
    expect(LOCACAO_COMERCIAL_STEP_LABELS).toHaveLength(7);
    // Guard do index-shift do wizard: partes em 1-2, imóvel em 3, aluguel em 4.
    expect(LOCACAO_STEP_LABELS[1]).toBe("Locador(es)");
    expect(LOCACAO_STEP_LABELS[2]).toBe("Locatário(s)");
    expect(LOCACAO_STEP_LABELS[3]).toBe("Imóvel");
    expect(LOCACAO_STEP_LABELS[4]).toBe("Aluguel e Reajuste");
  });
});
