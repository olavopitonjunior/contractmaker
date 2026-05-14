"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import type { FieldErrors } from "react-hook-form";

interface RequiredFieldMarkerProps {
  /** Paths obrigatórios deste step (já filtrados). */
  requiredFields: readonly string[];
  /** Erros atuais do RHF (props.formState.errors). */
  errors: FieldErrors;
  /**
   * Trigger pra scroll/animação: tipicamente o `failedTriggerCount` que
   * incrementa toda vez que o usuário clica "Próximo" com erro. Re-scrolla
   * mesmo no mesmo campo após segundo clique.
   */
  trigger: number;
}

function getErrorAtPath(errors: FieldErrors, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = errors;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function countInvalid(
  required: readonly string[],
  errors: FieldErrors,
): { invalid: number; firstPath: string | null } {
  let invalid = 0;
  let firstPath: string | null = null;
  for (const path of required) {
    const node = getErrorAtPath(errors, path);
    // RHF errors são objetos `{ type, message }` ou aninhados. Qualquer
    // truthy aqui indica que aquele path tem erro registrado.
    if (node && typeof node === "object") {
      const maybeMsg = (node as { message?: unknown }).message;
      if (typeof maybeMsg === "string" || Object.keys(node).length > 0) {
        invalid++;
        if (!firstPath) firstPath = path;
      }
    }
  }
  return { invalid, firstPath };
}

/**
 * Bolha sticky no topo do formulário com contagem "N/M pendências".
 * Substitui o toast genérico "Preencha os campos obrigatórios" que era
 * pouco acionável — agora a contagem é visível enquanto o usuário corrige.
 *
 * Quando `trigger` muda (clique em Próximo com falha), scrolla até o
 * primeiro campo com `[aria-invalid="true"]` no DOM, focando-o se for
 * input/textarea/select.
 */
export function RequiredFieldMarker({
  requiredFields,
  errors,
  trigger,
}: RequiredFieldMarkerProps) {
  const { invalid } = countInvalid(requiredFields, errors);
  const total = requiredFields.length;

  useEffect(() => {
    if (trigger === 0) return;
    // Aguarda o RHF terminar de propagar aria-invalid pros DOM nodes.
    const t = window.setTimeout(() => {
      const firstInvalid = document.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      );
      if (firstInvalid) {
        firstInvalid.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        if (
          firstInvalid.tagName === "INPUT" ||
          firstInvalid.tagName === "TEXTAREA" ||
          firstInvalid.tagName === "SELECT"
        ) {
          (firstInvalid as HTMLInputElement | HTMLTextAreaElement).focus({
            preventScroll: true,
          });
        }
      }
    }, 50);
    return () => window.clearTimeout(t);
  }, [trigger]);

  if (invalid === 0 || total === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-2 z-10 mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
    >
      <AlertCircle className="h-3.5 w-3.5" />
      {invalid} de {total} {total === 1 ? "pendência" : "pendências"} nesta
      etapa
    </div>
  );
}
