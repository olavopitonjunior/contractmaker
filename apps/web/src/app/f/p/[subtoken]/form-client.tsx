"use client";

import { SalesFormWizard } from "@/components/forms/SalesFormWizard";

interface SubtokenFormClientProps {
  subtoken: string;
  role: "vendedor" | "comprador";
  initialData: Record<string, unknown>;
  requiredFieldsByStep: readonly (readonly string[])[];
  stepIndexes: readonly number[];
  pathScope: readonly string[];
  formTitle: string | null;
  completedAt: string | null;
}

export function SubtokenFormClient({
  subtoken,
  role,
  initialData,
  requiredFieldsByStep,
  stepIndexes,
  pathScope,
  formTitle,
  completedAt,
}: SubtokenFormClientProps) {
  const roleLabel = role === "vendedor" ? "Vendedor(a)" : "Comprador(a)";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-6 py-4 shrink-0">
        <div className="mx-auto max-w-4xl flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              CM
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">
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
        <SalesFormWizard
          token={subtoken}
          initialData={initialData}
          requiredFieldsByStep={requiredFieldsByStep}
          stepIndexes={stepIndexes}
          endpoint={`/api/forms/participant/${subtoken}`}
          pathScope={pathScope}
          finalizeMode="participant"
        />
      </main>
    </div>
  );
}
