"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

interface RequiredFieldMarkerProps {
  /** Quantos campos obrigatórios desta etapa estão vazios. */
  missing: number;
  /** Total de campos obrigatórios da etapa (já ciente de tipo_pessoa). */
  total: number;
  /**
   * Quando false, a bolha nunca aparece (ex.: form em branco sem prefill, antes
   * do usuário tentar avançar). Quando true, exibe a contagem proativamente.
   */
  visible: boolean;
  /**
   * Trigger pra scroll/animação: tipicamente o `failedTriggerCount` que
   * incrementa toda vez que o usuário clica "Próximo" com erro. Re-scrolla
   * mesmo no mesmo campo após segundo clique.
   */
  trigger: number;
}

/**
 * Bolha sticky no topo do formulário com a contagem "N de M pendências".
 * A contagem é calculada no wizard a partir dos VALORES atuais (não de erros),
 * então some sozinha conforme o usuário preenche. Em forms `?prefilled=1` a
 * bolha é proativa (`visible`); em forms em branco só aparece após um
 * "Próximo" com falha.
 *
 * Quando `trigger` muda (clique em Próximo com falha), scrolla até o primeiro
 * campo com `[aria-invalid="true"]` no DOM, focando-o se for input/textarea/select.
 */
export function RequiredFieldMarker({
  missing,
  total,
  visible,
  trigger,
}: RequiredFieldMarkerProps) {
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

  if (!visible || missing === 0 || total === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-2 z-10 mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
    >
      <AlertCircle className="h-3.5 w-3.5" />
      {missing} de {total} {total === 1 ? "pendência" : "pendências"} nesta
      etapa
    </div>
  );
}
