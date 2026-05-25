import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { OnboardingWizard } from "@/components/financeiro/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Onboarding financeiro",
};

/**
 * Bootstrap onboarding — só renderiza se a org ainda não tem nenhuma conta.
 * Caso contrário, redireciona pra /settings/pagamentos/contas (que tem o
 * fluxo multi-account completo).
 */
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const count = await prisma.asaasAccount.count({ where: { orgId: org.id } });
  if (count > 0) {
    redirect("/settings/pagamentos/contas");
  }

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
