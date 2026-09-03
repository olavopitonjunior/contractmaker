import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { PessoaFisicaLocacaoFields } from "@/components/forms/steps/locacao/_PartyFields";

/**
 * 2026-09-02 — o "mostrar cônjuge" usava igualdade estrita com "Casado(a)" /
 * "União Estável", enquanto o finalize (`collectConjugeIssues` → `isMarried`)
 * normaliza. O OCR devolve "casado" e "União estável": o finalize cobrava nome
 * e CPF do cônjuge e a tela não tinha o campo. Vale para locador, locatário e
 * fiador — os três renderizam por `PessoaFisicaLocacaoFields`.
 */

function Harness({ prefix, estadoCivil }: { prefix: string; estadoCivil: string }) {
  const defaults: Record<string, unknown> = {};
  const segs = prefix.split(".");
  let cur = defaults;
  for (const seg of segs.slice(0, -1)) {
    cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = { tipo_pessoa: "fisica", estado_civil: estadoCivil };
  const form = useForm<Record<string, unknown>>({ defaultValues: defaults });
  return <PessoaFisicaLocacaoFields form={form} prefix={prefix} />;
}

afterEach(() => cleanup());

describe("PessoaFisicaLocacaoFields — cônjuge aparece pelo mesmo predicado do finalize", () => {
  it.each([
    ["Casado(a)", "garantia.fiador"],
    ["casado", "garantia.fiador"],
    ["União estável", "locatarios.0"],
    ["casada", "locadores.0"],
  ])("estado civil %s (%s) mostra os campos do cônjuge", (estadoCivil, prefix) => {
    render(<Harness prefix={prefix} estadoCivil={estadoCivil} />);
    expect(screen.getByText(/Nome do Cônjuge/)).toBeTruthy();
  });

  it.each(["Solteiro(a)", "Divorciado(a)", ""])(
    "estado civil %s não mostra o cônjuge",
    (estadoCivil) => {
      render(<Harness prefix="garantia.fiador" estadoCivil={estadoCivil} />);
      expect(screen.queryByText(/Nome do Cônjuge/)).toBeNull();
    }
  );
});
