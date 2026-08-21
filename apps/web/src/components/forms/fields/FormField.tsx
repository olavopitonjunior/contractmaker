"use client";

import { cloneElement, isValidElement, type ReactElement } from "react";
import { useFormState, type UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { useRequiredField } from "@/components/forms/RequiredFieldsContext";

/** Lê `a.0.b` de um objeto de erros aninhado do RHF. */
function errorAtPath(errors: unknown, path: string): { message?: string } | undefined {
  let cur: unknown = errors;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur && typeof cur === "object" ? (cur as { message?: string }) : undefined;
}

/**
 * Campo do formulário público: rótulo + asterisco dinâmico + `aria-invalid` no
 * input + mensagem de erro inline.
 *
 * Substitui os `FormField` locais que cada step declarava — wrappers burros que
 * só empilhavam Label e children. Três consequências que este componente
 * conserta de uma vez:
 *
 *  1. O asterisco vem da CONFIGURAÇÃO da org (RequiredFieldsContext), não de
 *     uma string fixa no label que ninguém sincronizava com o preset.
 *  2. `aria-invalid` chega ao input. Sem ele a borda vermelha de `ui/input.tsx`
 *     (`aria-invalid:border-destructive`) nunca acendia E o scroll/focus do
 *     `RequiredFieldMarker` — que procura `[aria-invalid="true"]` — era código
 *     morto: o `setError` do wizard rodava e nada acontecia na tela.
 *  3. A mensagem de erro passa a existir em TODO campo, não só nos ~5 por step
 *     que tinham `<FieldError>` escrito à mão.
 *
 * A assinatura recebe `form` (em vez de usar `useFormContext`) porque os steps
 * já recebem o objeto por prop e não há `FormProvider` na árvore — introduzir
 * um exigiria mexer nos dois wizards de uma vez.
 */
export function FormField({
  form,
  name,
  label,
  required,
  className = "",
  hint,
  children,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  /** Dot-path REAL do campo, com índice (`vendedores.1.cpf`). */
  name: string;
  label: string;
  /** Força a obrigatoriedade; omitido, consulta a configuração da org. */
  required?: boolean;
  className?: string;
  /** Texto auxiliar abaixo do campo (some quando há erro, pra não empilhar). */
  hint?: string;
  children: ReactElement;
}) {
  // Assinatura GRANULAR: `useFormState` com `name` re-renderiza este campo (e
  // só ele) quando o erro dele muda. Ler `form.formState.errors` direto
  // assinaria o formState inteiro e faria o wizard repintar a cada tecla.
  const { errors } = useFormState({ control: form.control, name });
  const error = errorAtPath(errors, name);
  const configRequired = useRequiredField(name);
  const isRequired = required ?? configRequired;
  const message = typeof error?.message === "string" ? error.message : null;
  // Id derivado do path (estável entre renders e único por campo) — liga o
  // label ao controle e a mensagem à descrição acessível. Sem isso, quem usa
  // leitor de tela continuava sem saber que o campo é obrigatório nem qual é o
  // erro: exatamente a lacuna que este componente fecha no visual.
  const fieldId = `ff-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const describedBy = message ? `${fieldId}-msg` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={fieldId} className="text-sm font-medium text-muted-foreground">
        {label}
        {isRequired && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
        {isRequired && <span className="sr-only">(obrigatório)</span>}
      </Label>
      {/* `cloneElement` exige elemento único — o guard evita quebrar em runtime
          se alguém passar texto ou fragmento por engano. O `id` do filho vence
          o gerado: componente que já traz o próprio id continua mandando. */}
      {isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            id:
              (children as ReactElement<Record<string, unknown>>).props.id ?? fieldId,
            "aria-invalid": error ? true : undefined,
            "aria-required": isRequired || undefined,
            "aria-describedby": describedBy,
          })
        : children}
      {message ? (
        <p id={`${fieldId}-msg`} className="text-xs text-destructive">
          {message}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
