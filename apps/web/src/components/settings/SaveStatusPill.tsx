"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrgSettingsSaveStatus } from "@/hooks/use-org-settings-form";

/**
 * Indicador do autosave. Fica discreto — o usuário só precisa saber que o dado
 * está seguro (ou que falhou). Espelha os estados de `useOrgSettingsForm`.
 */
export function SaveStatusPill({
  status,
  isDirty,
  error,
  className,
}: {
  status: OrgSettingsSaveStatus;
  isDirty?: boolean;
  /**
   * Motivo da falha, vindo da API ("CNPJ inválido"). Some do texto — a pill é
   * discreta de propósito — mas fica no `title`: sem o botão "Salvar", que
   * mostrava a mensagem exata em toast, este é o único lugar onde o usuário
   * ainda alcança o porquê de um 400. Erro de permissão continua em toast,
   * porque ali não há o que corrigir digitando.
   */
  error?: string | null;
  className?: string;
}) {
  if (status === "idle" && !isDirty) return null;

  const content =
    status === "saving" ? (
      <>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Salvando…
      </>
    ) : status === "saved" ? (
      <>
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        Salvo
      </>
    ) : status === "error" ? (
      <>
        <CircleAlert className="h-3.5 w-3.5" />
        Não foi possível salvar
      </>
    ) : (
      <>Alterações não salvas</>
    );

  return (
    <span
      aria-live="polite"
      title={status === "error" && error ? error : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        status === "saved" && "text-success",
        status === "error" && "text-destructive",
        (status === "saving" || status === "idle") && "text-muted-foreground",
        className
      )}
    >
      {content}
    </span>
  );
}
