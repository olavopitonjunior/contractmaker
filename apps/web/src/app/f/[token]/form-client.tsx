"use client";

import { SalesFormWizard } from "@/components/forms/SalesFormWizard";
import { LocacaoFormWizard } from "@/components/forms/LocacaoFormWizard";
import { isLocacaoSchemaType } from "@/lib/forms/validation-locacao";
import { BrandMark } from "@/components/layout/brand-mark";

interface FormPageClientProps {
  token: string;
  schemaType: string;
  initialData: Record<string, unknown>;
  requiredFieldsByStep: readonly (readonly string[])[];
  prefilled?: boolean;
  proposalAttachmentUrl?: string | null;
}

export function FormPageClient({
  token,
  schemaType,
  initialData,
  requiredFieldsByStep,
  prefilled,
  proposalAttachmentUrl,
}: FormPageClientProps) {
  const isLocacao = isLocacaoSchemaType(schemaType);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-6 py-4 shrink-0">
        <div className="mx-auto max-w-4xl flex items-center gap-3">
          <BrandMark className="h-8 w-8 text-primary" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground leading-none">
              imobpro<span className="text-brand-accent">.ai</span>
            </p>
            <h1 className="font-display text-lg font-semibold tracking-tight leading-tight">
              {isLocacao ? "Formulário de Locação" : "Formulário de Venda"}
            </h1>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-4xl p-6 pb-16">
        {isLocacao ? (
          <LocacaoFormWizard token={token} initialData={initialData} schemaType={schemaType} />
        ) : (
          <SalesFormWizard
            token={token}
            initialData={initialData}
            requiredFieldsByStep={requiredFieldsByStep}
            prefilled={prefilled}
            proposalAttachmentUrl={proposalAttachmentUrl}
          />
        )}
      </main>
    </div>
  );
}
