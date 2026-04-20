import { OnboardingWizard } from "@/components/financeiro/onboarding/OnboardingWizard";

export const metadata = {
  title: "Onboarding financeiro — Contractmaker",
};

export default function OnboardingPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurar conta Asaas</h1>
        <p className="text-sm text-muted-foreground">
          Abra sua subconta para começar a receber comissões pelo Contractmaker.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
