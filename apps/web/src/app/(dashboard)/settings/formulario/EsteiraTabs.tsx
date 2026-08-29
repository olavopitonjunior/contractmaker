"use client";

import { createContext, useContext, useState } from "react";
import type { FormModule } from "@/lib/forms/presets";

/**
 * Seletor ÚNICO de esteira da tela `/settings/formulario`.
 *
 * Antes desta extração a página tinha três seletores concorrentes — as pílulas
 * do card "Campos obrigatórios", as `Tabs` próprias do padrão contratual e a
 * matriz lado-a-lado da visibilidade por parte — e o catálogo de seguradoras
 * não obedecia a nenhum: aparecia com "Vendas" selecionado, sendo que
 * seguradora é prestadora de garantia LOCATÍCIA e não existe em venda.
 *
 * O estado sobe para cá e desce por context; a página segue Server Component
 * (os cards entram como `children`, já renderizados no servidor) e quem precisa
 * da esteira lê `useEsteira()`.
 */

const EsteiraContext = createContext<FormModule>("venda");

export function useEsteira(): FormModule {
  return useContext(EsteiraContext);
}

const MODULE_LABEL: Record<FormModule, string> = {
  venda: "Vendas",
  locacao: "Locação",
};

export function EsteiraTabs({
  locacaoEnabled,
  children,
}: {
  /** Módulo de locação habilitado pro tenant (lib/modules). */
  locacaoEnabled: boolean;
  children: React.ReactNode;
}) {
  const [esteira, setEsteira] = useState<FormModule>("venda");
  // Org sem o módulo nunca sai de venda — e não vê seletor nenhum.
  const value: FormModule = locacaoEnabled ? esteira : "venda";

  return (
    <EsteiraContext.Provider value={value}>
      {locacaoEnabled && (
        <div className="inline-flex rounded-lg border p-0.5 w-fit">
          {(["venda", "locacao"] as FormModule[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEsteira(m)}
              aria-pressed={value === m}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                value === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {MODULE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-6">{children}</div>
    </EsteiraContext.Provider>
  );
}

/**
 * Mostra o filho só na esteira indicada. Existe porque a página é Server
 * Component: ela renderiza o card (com os dados que só o servidor tem) e passa
 * o elemento pronto; quem decide se ele aparece é este client component, que
 * consegue ler o context.
 */
export function EsteiraOnly({
  esteira,
  children,
}: {
  esteira: FormModule;
  children: React.ReactNode;
}) {
  return useEsteira() === esteira ? <>{children}</> : null;
}
