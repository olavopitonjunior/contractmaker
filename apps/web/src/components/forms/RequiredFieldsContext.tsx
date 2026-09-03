"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * Paths obrigatórios EFETIVOS do formulário, disponíveis para os steps.
 *
 * Os wizards já calculavam essa lista (preset da org + remap PF/PJ) para
 * decidir se o "Próximo" passa, mas ela morria lá dentro: os steps recebiam só
 * `form`, então o asterisco de cada campo era string fixa no label e não tinha
 * relação nenhuma com o que a imobiliária configurou em /settings/formulario.
 * Com preset `completo`, o cliente via "RG" e "Nome da mãe" idênticos a campos
 * opcionais e só descobria que eram obrigatórios ao tentar avançar.
 *
 * O Set guarda os paths NORMALIZADOS (índice colapsado em `.0.`) porque os
 * presets declaram no índice 0 (`vendedores.0.cpf`) e a exigência vale para
 * toda parte da lista — o mesmo motivo pelo qual `effectiveRequiredPaths`
 * expande por índice no gate de navegação.
 */
const RequiredFieldsContext = createContext<ReadonlySet<string>>(new Set());

/** `vendedores.2.conjuge.nome` → `vendedores.0.conjuge.nome`. */
export function normalizeIndexes(path: string): string {
  return path.replace(/\.\d+(?=\.)/g, ".0").replace(/\.\d+$/, ".0");
}

/** Campo de identidade do titular, coberto pelo path guarda-chuva da lista. */
const NAME_FIELD_RE = /^([a-z]+)\.\d+\.(nome|razao_social)$/;

export function RequiredFieldsProvider({
  paths,
  floorPaths = [],
  children,
}: {
  /** Paths obrigatórios (crus, como vêm do preset/wizard). */
  paths: readonly string[];
  /**
   * Paths obrigatórios pelo PISO do wizard, não pelo preset da org (nome da
   * parte, valor do aluguel, nome do fiador). Entram no mesmo Set porque o
   * asterisco tem que refletir o que o gate barra — quando o piso cede à
   * configuração, o wizard manda a lista vazia e o asterisco cai junto. Antes
   * disso, esses campos tinham `required` cravado no step e o asterisco
   * continuaria mesmo depois de o gate parar de exigi-los.
   */
  floorPaths?: readonly string[];
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => new Set([...paths, ...floorPaths].map(normalizeIndexes)),
    // `paths` costuma ser recriado a cada render nos wizards; o join estabiliza
    // a memo sem obrigar o chamador a memoizar do lado dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paths.join("|"), floorPaths.join("|")]
  );
  return (
    <RequiredFieldsContext.Provider value={value}>
      {children}
    </RequiredFieldsContext.Provider>
  );
}

/**
 * Este path é obrigatório na configuração vigente?
 *
 * Trata o path GUARDA-CHUVA da lista (`vendedores` no preset) do mesmo jeito
 * que o gate de formato do wizard: com ele presente, o nome/razão social do
 * titular conta como obrigatório, mesmo sem um path próprio no preset.
 */
export function useRequiredField(path: string): boolean {
  const set = useContext(RequiredFieldsContext);
  const normalized = normalizeIndexes(path);
  if (set.has(normalized)) return true;
  const m = NAME_FIELD_RE.exec(normalized);
  return m ? set.has(m[1]) : false;
}
