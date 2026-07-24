"use client";

import { useMemo } from "react";
import { SalesFormWizard } from "@/components/forms/SalesFormWizard";
import { LocacaoFormWizard } from "@/components/forms/LocacaoFormWizard";
import { BrandMark } from "@/components/layout/brand-mark";
import type { ParticipantRole } from "@/lib/forms/participant-token";
import type { Assignment } from "@/lib/forms/extracted-to-form";

interface SubtokenFormClientProps {
  subtoken: string;
  role: ParticipantRole;
  /** SalesForm.schemaType — locacao_* renderiza o LocacaoFormWizard. */
  schemaType: string;
  initialData: Record<string, unknown>;
  requiredFieldsByStep: readonly (readonly string[])[];
  stepIndexes: readonly number[];
  pathScope: readonly string[];
  /** SalesFormParticipant.partyIndex — slot do próprio participante. */
  partyIndex?: number;
  formTitle: string | null;
  completedAt: string | null;
  /** Form travado (SalesForm.lockedAt) → wizard somente-leitura. */
  locked?: boolean;
}

/**
 * Roles cujo link individual tem um slot de parte próprio pro auto-assign de
 * OCR (Fix 4 do DocumentosStep). Fiador fica fora — os dados moram no objeto
 * `garantia`, não num array de partes.
 */
const SELF_ASSIGN_KIND: Partial<Record<ParticipantRole, Assignment["kind"]>> = {
  vendedor: "vendedor",
  comprador: "comprador",
  locador: "locador",
  locatario: "locatario",
};

const ROLE_LABELS: Record<ParticipantRole, string> = {
  vendedor: "Vendedor(a)",
  comprador: "Comprador(a)",
  locador: "Locador(a)",
  locatario: "Locatário(a)",
  fiador: "Fiador(a)",
};

export function SubtokenFormClient({
  subtoken,
  role,
  schemaType,
  initialData,
  requiredFieldsByStep,
  stepIndexes,
  pathScope,
  partyIndex = 0,
  formTitle,
  completedAt,
  locked,
}: SubtokenFormClientProps) {
  const roleLabel = ROLE_LABELS[role] ?? role;
  const isLocacao = schemaType.startsWith("locacao");
  const participantEndpoint = `/api/forms/participant/${subtoken}`;
  const selfKind = SELF_ASSIGN_KIND[role];
  // Referência estável — vira dep de effect no DocumentosStep.
  const selfAssignment = useMemo<Assignment | undefined>(
    () => (selfKind ? { kind: selfKind, index: partyIndex } : undefined),
    [selfKind, partyIndex],
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-6 py-4 shrink-0">
        <div className="mx-auto max-w-4xl flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <BrandMark className="h-8 w-8 text-primary" />
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight leading-tight">
                Preencha seus dados como {roleLabel}
              </h1>
              {formTitle && (
                <p className="text-xs text-muted-foreground leading-tight">
                  {formTitle}
                </p>
              )}
            </div>
          </div>
          <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            Link exclusivo da parte {roleLabel.toLowerCase()}
          </span>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-4xl p-6 pb-16">
        {completedAt ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center dark:border-green-900 dark:bg-green-950/40">
            <p className="text-base font-medium text-green-800 dark:text-green-200">
              Seus dados já foram salvos!
            </p>
            <p className="text-sm text-green-700/80 dark:text-green-300/80 mt-1">
              A imobiliária recebeu suas informações. Você pode revisar/editar
              se precisar.
            </p>
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            Este link mostra apenas os campos que pertencem a você como{" "}
            <strong>{roleLabel.toLowerCase()}</strong>. A outra parte recebeu um
            link separado e não vê seus dados.
          </div>
        )}
        {isLocacao ? (
          <LocacaoFormWizard
            token={subtoken}
            initialData={initialData}
            schemaType={schemaType}
            stepIndexes={stepIndexes}
            endpoint={participantEndpoint}
            pathScope={pathScope}
            selfAssignment={selfAssignment}
            finalizeMode="participant"
            readOnly={locked}
          />
        ) : (
          <SalesFormWizard
            token={subtoken}
            initialData={initialData}
            requiredFieldsByStep={requiredFieldsByStep}
            stepIndexes={stepIndexes}
            endpoint={participantEndpoint}
            pathScope={pathScope}
            selfAssignment={selfAssignment}
            finalizeMode="participant"
            readOnly={locked}
          />
        )}
      </main>
    </div>
  );
}
