"use client";

import type { FormModule } from "@/lib/forms/presets";

/**
 * Seletor de esteira CONTROLADO — venda × locação.
 *
 * É só a superfície visual, extraída de `settings/formulario/EsteiraTabs.tsx`
 * pra que as duas telas tenham o mesmo seletor. O `EsteiraTabs` continua onde
 * está: ele é um provider de context feito pro padrão daquela página (Server
 * Component passando cards já renderizados como `children`), que não serve numa
 * tela 100% client como `/clauses`.
 *
 * Regra preservada: org sem o módulo de locação não vê seletor nenhum e fica
 * em venda — igual ao comportamento de `/settings/formulario`.
 */
const MODULE_LABEL: Record<FormModule, string> = {
  venda: "Vendas",
  locacao: "Locação",
};

export function EsteiraSwitch({
  value,
  onChange,
  locacaoEnabled,
  counts,
}: {
  value: FormModule;
  onChange: (next: FormModule) => void;
  locacaoEnabled: boolean;
  /** Quantidade por esteira, exibida ao lado do rótulo. Opcional. */
  counts?: Partial<Record<FormModule, number>>;
}) {
  if (!locacaoEnabled) return null;

  return (
    <div className="inline-flex rounded-lg border p-0.5 w-fit" role="tablist">
      {(["venda", "locacao"] as FormModule[]).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          onClick={() => onChange(m)}
          aria-selected={value === m}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === m
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {MODULE_LABEL[m]}
          {counts?.[m] !== undefined && (
            <span className="ml-1.5 opacity-70">({counts[m]})</span>
          )}
        </button>
      ))}
    </div>
  );
}
