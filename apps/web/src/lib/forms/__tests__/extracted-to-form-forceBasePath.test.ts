import { describe, it, expect, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import {
  mapExtractedToForm,
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
  return {
    form: { setValue, getValues } as unknown as UseFormReturn<
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
