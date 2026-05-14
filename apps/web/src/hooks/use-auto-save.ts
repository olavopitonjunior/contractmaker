"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveOptions {
  /**
   * Endpoint override. Default `/api/forms/${token}` (token principal).
   * Subtoken por parte (PR 4) passa `/api/forms/participant/${subtoken}`.
   */
  endpoint?: string;
  /**
   * Allowlist de chaves top-level pra serializar. Quando definido, apenas
   * essas chaves de `data` vão no PATCH — server-side `deepMergeAtPaths`
   * (PR 1) aplica filtro adicional. Default `undefined` (manda tudo).
   *
   * Usado por subtokens vendedor (`["vendedores","imoveis"]`) e comprador
   * (`["compradores"]`) pra evitar mandar defaults vazios que poderiam
   * sobrescrever dados da outra parte se o server falhasse.
   */
  pathScope?: readonly string[];
  debounceMs?: number;
}

export function useAutoSave(
  token: string,
  data: Record<string, unknown>,
  optionsOrDebounce: UseAutoSaveOptions | number = {},
) {
  const options: UseAutoSaveOptions =
    typeof optionsOrDebounce === "number"
      ? { debounceMs: optionsOrDebounce }
      : optionsOrDebounce;
  const debounceMs = options.debounceMs ?? 1500;
  const endpoint = options.endpoint ?? `/api/forms/${token}`;
  const pathScope = options.pathScope;

  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Mantém referência estável do scope evitando re-trigger quando o caller
  // passa um array literal a cada render.
  const scopeKey = useMemo(
    () => (pathScope ? pathScope.join("|") : ""),
    [pathScope],
  );

  const slice = useCallback(
    (full: Record<string, unknown>): Record<string, unknown> => {
      if (!pathScope) return full;
      const out: Record<string, unknown> = {};
      for (const key of pathScope) {
        if (key in full) out[key] = full[key];
      }
      return out;
    },
    // pathScope captured via scopeKey to keep referential stability
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey],
  );

  const save = useCallback(
    async (dataToSave: Record<string, unknown>) => {
      const sliced = slice(dataToSave);
      const serialized = JSON.stringify(sliced);
      if (serialized === lastSavedRef.current) return;

      setStatus("saving");
      try {
        const res = await fetch(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataJson: sliced }),
        });

        if (!mountedRef.current) return;

        if (res.ok) {
          lastSavedRef.current = serialized;
          setStatus("saved");
          setTimeout(() => {
            if (mountedRef.current) setStatus("idle");
          }, 2000);
        } else {
          setStatus("error");
        }
      } catch {
        if (mountedRef.current) setStatus("error");
      }
    },
    [endpoint, slice],
  );

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const serialized = JSON.stringify(slice(data));
    if (serialized === lastSavedRef.current || serialized === "{}") return;

    timeoutRef.current = setTimeout(() => {
      save(data);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data, debounceMs, save, slice]);

  return { status, save: () => save(data) };
}
