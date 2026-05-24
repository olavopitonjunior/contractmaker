import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { isOrgOwner } from "@/lib/asaas/account";
import { OnboardingWizard } from "@/components/financeiro/onboarding/OnboardingWizard";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Nova conta bancária",
};

export default async function NovaContaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const isOwner = await isOrgOwner(session.user.id, org.id);
  if (!isOwner) {
    redirect("/settings/pagamentos/contas");
  }

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-4">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
          <Link href="/settings/pagamentos/contas">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Nova conta bancária Asaas</h1>
        <p className="text-sm text-muted-foreground">
          Preencha os dados de KYC. A conta passa por análise da Asaas (~1 dia
          útil em produção). Depois de aprovada, você pode torná-la a ativa
          da organização.
        </p>
      </div>
      <OnboardingWizard mode="newAccount" />
    </div>
  );
}
