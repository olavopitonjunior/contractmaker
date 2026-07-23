import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useDirtyTopLevelScope } from "../use-dirty-scope";

/**
 * Monta um useForm real + o hook sob teste no mesmo render — o dirtyFields do
 * RHF é um Proxy por subscription, então testar contra mock não prova nada.
 */
function setup(roleScope?: readonly string[]) {
  return renderHook(() => {
    const form = useForm({
      defaultValues: {
        vendedores: [{ nome: "", cpf: "" }],
        pagamento: { valor_total: 0 },
      },
    });
    const scope = useDirtyTopLevelScope(form.control, roleScope);
    return { form, scope };
  });
}

describe("useDirtyTopLevelScope", () => {
  it("nada tocado → escopo vazio (o auto-save de mount vira no-op)", () => {
    const { result } = setup();
    expect(result.current.scope).toEqual([]);
  });

  it("setValue com shouldDirty inclui a chave top-level", () => {
    const { result } = setup();
    act(() => {
      result.current.form.setValue("vendedores.0.nome", "Francielly", {
        shouldDirty: true,
      });
    });
    expect(result.current.scope).toEqual(["vendedores"]);
  });

  it("sticky: reverter o campo ao default NÃO tira a chave do escopo", () => {
    const { result } = setup();
    act(() => {
      result.current.form.setValue("vendedores.0.nome", "Francielly", {
        shouldDirty: true,
      });
    });
    act(() => {
      // Volta ao default ("") — o RHF des-suja o campo, mas a limpeza ainda
      // precisa ser persistida pelo auto-save.
      result.current.form.setValue("vendedores.0.nome", "", {
        shouldDirty: true,
      });
    });
    expect(result.current.scope).toEqual(["vendedores"]);
  });

  it("shouldDirty:false (fills programáticos) fica fora do escopo", () => {
    const { result } = setup();
    act(() => {
      result.current.form.setValue("pagamento.valor_total", 500, {
        shouldDirty: false,
      });
    });
    expect(result.current.scope).toEqual([]);
  });

  it("roleScope (subtoken) limita por interseção", () => {
    const { result } = setup(["vendedores", "imoveis"]);
    act(() => {
      result.current.form.setValue("vendedores.0.nome", "Ana", {
        shouldDirty: true,
      });
      result.current.form.setValue("pagamento.valor_total", 100, {
        shouldDirty: true,
      });
    });
    // pagamento está sujo mas fora do papel — não entra.
    expect(result.current.scope).toEqual(["vendedores"]);
  });

  it("retorno é referencialmente estável enquanto o conjunto não muda", () => {
    const { result, rerender } = setup();
    act(() => {
      result.current.form.setValue("vendedores.0.nome", "Ana", {
        shouldDirty: true,
      });
    });
    const first = result.current.scope;
    rerender();
    expect(result.current.scope).toBe(first);
  });
});
