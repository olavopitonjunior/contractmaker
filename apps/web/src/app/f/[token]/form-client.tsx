"use client";

import { SalesFormWizard } from "@/components/forms/SalesFormWizard";
import { LocacaoFormWizard } from "@/components/forms/LocacaoFormWizard";
import { isLocacaoSchemaType } from "@/lib/forms/validation-locacao";
import type { GarantiaOptionLike } from "@/lib/forms/garantia-catalog";
import { BrandWordmark } from "@/components/layout/brand-mark";

interface FormPageClientProps {
  token: string;
  schemaType: string;
  initialData: Record<string, unknown>;
  requiredFieldsByStep: readonly (readonly string[])[];
  /** Catálogo de garantias da org — só usado no wizard de locação. */
  garantiaOptions?: readonly GarantiaOptionLike[];
  prefilled?: boolean;
  proposalAttachmentUrl?: string | null;
  /** Form travado (SalesForm.lockedAt) → wizard somente-leitura. */
  locked?: boolean;
  /**
   * Visitante tem OrgMembership na org do form (`viewerIsOrgMember`, resolvido
   * server-side). Libera os campos de recebimento da comissão na etapa de
   * Comissão E remover documento na etapa 0 — o link público está normalmente
   * com o cliente, que não deve ver nem uma coisa nem outra.
   */
  viewerIsMember?: boolean;
  requireCommissionerReceiving?: boolean;
  /** Logo da imobiliária (BrandingSettings.logoUrl). Ausente = marca do produto. */
  brandLogoUrl?: string | null;
  brandDisplayName?: string | null;
}

export function FormPageClient({
  token,
  schemaType,
  initialData,
  requiredFieldsByStep,
  garantiaOptions,
  prefilled,
  proposalAttachmentUrl,
  locked,
  viewerIsMember,
  requireCommissionerReceiving,
  brandLogoUrl,
  brandDisplayName,
}: FormPageClientProps) {
  const isLocacao = isLocacaoSchemaType(schemaType);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-6 py-4 shrink-0">
        <div className="mx-auto max-w-4xl flex items-center gap-3">
          {/* Com logo do tenant, ele SUBSTITUI a marca do produto (mesmo
              comportamento do dashboard e da página de cobrança). Sem logo,
              cai no "imobpro.ai" de sempre. */}
          <BrandWordmark
            logoUrl={brandLogoUrl ?? undefined}
            displayName={brandDisplayName ?? undefined}
            markClassName="h-8 w-8 text-primary"
          />
          <div className="border-l border-border pl-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground leading-none">
              {brandDisplayName ?? "Formulário"}
            </p>
            <h1 className="font-display text-lg font-semibold tracking-tight leading-tight">
              {isLocacao ? "Formulário de Locação" : "Formulário de Venda"}
            </h1>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-4xl p-6 pb-16">
        {isLocacao ? (
          <LocacaoFormWizard
            token={token}
            initialData={initialData}
            schemaType={schemaType}
            requiredFieldsByStep={requiredFieldsByStep}
            garantiaOptions={garantiaOptions}
            readOnly={locked}
            viewerIsMember={viewerIsMember}
            requireCommissionerReceiving={requireCommissionerReceiving}
          />
        ) : (
          <SalesFormWizard
            token={token}
            initialData={initialData}
            requiredFieldsByStep={requiredFieldsByStep}
            prefilled={prefilled}
            proposalAttachmentUrl={proposalAttachmentUrl}
            readOnly={locked}
            viewerIsMember={viewerIsMember}
            requireCommissionerReceiving={requireCommissionerReceiving}
          />
        )}
      </main>
    </div>
  );
}
