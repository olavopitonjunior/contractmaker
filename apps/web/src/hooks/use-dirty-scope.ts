"use client";

import { useMemo, useRef } from "react";
import { useFormState, type Control, type FieldValues } from "react-hook-form";

/**
 * Escopo top-level "sujo" pro auto-save dos wizards de form público.
 *
 * O auto-save do token principal mandava o estado RHF INTEIRO (useWatch sem
 * pathScope): uma aba hidratada ANTES de um participante salvar pelo link
 * individual ecoava `vendedores`/`compradores` com o template vazio de
 * defaultFormValues e — como arrays substituem inteiros no merge — apagava o
 * que a parte tinha gravado (lost update real em prod, 2026-07-23). Enviando
 * só as chaves top-level que ESTE cliente de fato tocou, a aba parada deixa
 * de fabricar escrita em fatia alheia.
 *
 * - `dirtyFields` vem de useFormState: o formState do RHF é um Proxy — a
 *   propriedade precisa ser LIDA (destructuring) pra ativar a subscription;
 *   useWatch não observa formState.
 * - Sticky: chaves só ENTRAM no set, nunca saem. O RHF "des-suja" um campo
 *   revertido ao default — sem o sticky, limpar um valor já salvo tiraria a
 *   chave do escopo e a limpeza nunca chegaria ao servidor.
 * - `roleScope` (subtoken): o retorno é a interseção roleScope ∩ dirty — a
 *   fatia do papel continua sendo o teto, e o eco de template no mount do
 *   subtoken também some (nada sujo = save vira no-op).
 *
 * O retorno é referencialmente estável enquanto o conjunto não muda (memo por
 * join ordenado, mesma técnica do scopeKey em use-auto-save.ts) pra não
 * re-agendar o debounce do auto-save a cada render.
 */
export function useDirtyTopLevelScope<T extends FieldValues>(
  control: Control<T>,
  roleScope?: readonly string[],
): readonly string[] {
  const { dirtyFields } = useFormState({ control });
  const stickyRef = useRef<Set<string>>(new Set());

  // Deriva por render: o objeto dirtyFields é mutável entre renders — nunca
  // memoizar pela identidade dele.
  for (const key of Object.keys(dirtyFields)) {
    stickyRef.current.add(key);
  }

  const dirtyKey = Array.from(stickyRef.current).sort().join("|");
  const roleKey = roleScope ? roleScope.join("|") : "";

  return useMemo(() => {
    const dirty = dirtyKey ? dirtyKey.split("|") : [];
    if (!roleKey) return dirty;
    const allowed = new Set(roleKey.split("|"));
    return dirty.filter((k) => allowed.has(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyKey, roleKey]);
}
