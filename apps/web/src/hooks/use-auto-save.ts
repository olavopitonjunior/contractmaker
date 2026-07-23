"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Motivo pelo qual o auto-save parou de vez. `form_locked`/`form_closed` vêm do
 * campo `reason` do 403; `http` é qualquer outro 4xx definitivo.
 */
export type AutoSaveStoppedReason = "form_locked" | "form_closed" | "http";

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
   * Os wizards passam o escopo dinâmico de useDirtyTopLevelScope (chaves que
   * ESTE cliente sujou, ∩ ROLE_PATHS no subtoken): uma aba parada não fabrica
   * escrita em fatia alheia — foi assim que o token principal apagou os
   * `vendedores` gravados por um link individual (lost update 2026-07-23).
   * Scope vazio ⇒ slice `{}` ⇒ nenhum PATCH sai.
   */
  pathScope?: readonly string[];
  debounceMs?: number;
  /**
   * Quando false, desliga o agendamento de saves (form travado / somente-leitura).
   * Default true. Evita PATCHs que só levariam 403 do servidor travado.
   */
  enabled?: boolean;
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
  const enabled = options.enabled ?? true;

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [stoppedReason, setStoppedReason] =
    useState<AutoSaveStoppedReason | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const mountedRef = useRef(true);
  /**
   * Trava definitiva após um 4xx não-retryável. Sem isso o hook re-agenda a
   * cada tecla: `lastSavedRef` só avança no sucesso, então `serialized !==
   * lastSavedRef` segue verdadeiro pra sempre e cada caractere digitado vira um
   * PATCH novo contra uma rota que já respondeu 403.
   */
  const stoppedRef = useRef(false);

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
      if (serialized === "{}") return; // scope vazio — nada a persistir
      if (stoppedRef.current) return;

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
          return;
        }

        // 4xx aqui é veredito, não falha transitória: o form travou, fechou ou
        // o link não vale mais. Retentar só queima request (a rota pública nem
        // passa pelo middleware de rate limit) e trava a pill em "erro".
        if (res.status >= 400 && res.status < 500) {
          const body = await res.json().catch(() => null);
          const reason: AutoSaveStoppedReason =
            body?.reason === "form_locked" || body?.reason === "form_closed"
              ? body.reason
              : "http";
          stoppedRef.current = true;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          if (mountedRef.current) setStoppedReason(reason);
        }
        setStatus("error");
      } catch {
        // Rede: pode ser transitório, então NÃO trava — o próximo keystroke
        // reagenda.
        if (mountedRef.current) setStatus("error");
      }
    },
    [endpoint, slice],
  );

  useEffect(() => {
    if (!enabled || stoppedRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const serialized = JSON.stringify(slice(data));
    if (serialized === lastSavedRef.current || serialized === "{}") return;

    timeoutRef.current = setTimeout(() => {
      save(data);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data, debounceMs, save, slice, enabled, stoppedReason]);

  return { status, stoppedReason, save: () => save(data) };
}
