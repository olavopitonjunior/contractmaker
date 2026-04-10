"use client";

import { SalesFormWizard } from "@/components/forms/SalesFormWizard";

interface FormPageClientProps {
  token: string;
  initialData: Record<string, unknown>;
}

export function FormPageClient({ token, initialData }: FormPageClientProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            CM
          </div>
          <h1 className="text-lg font-semibold">Formulario de Venda</h1>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-6">
        <SalesFormWizard token={token} initialData={initialData} />
      </main>
    </div>
  );
}
