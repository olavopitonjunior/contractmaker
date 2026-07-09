import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/login");

  const [status, account, orgData, modules] = await Promise.all([
    getOnboardingStatus(org.id),
    prisma.orgGoogleAccount.findUnique({
      where: { orgId: org.id },
      select: { email: true, status: true, lastErrorMessage: true },
    }),
    prisma.organization.findUnique({
      where: { id: org.id },
      select: { legalName: true, cnpj: true, creci: true, legalAddress: true },
    }),
    getOrgModules(org.id),
  ]);

  // Landing pós-onboarding: tenant só-locação vai pra /locacao; senão /pipeline.
  const landingHref =
    !isModuleEnabled(modules, MODULE.VENDAS) && isModuleEnabled(modules, MODULE.LOCACAO)
      ? "/locacao"
      : "/pipeline";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bem-vindo(a) 👋"
        description="Vamos deixar tudo pronto para você gerar o seu primeiro contrato."
      />
      <OnboardingWizard
        initialStatus={status}
        google={{
          connected: account?.status === "connected",
          status: account?.status ?? "disconnected",
          email: account?.email ?? null,
          lastErrorMessage: account?.lastErrorMessage ?? null,
        }}
        profile={{
          legalName: orgData?.legalName,
          cnpj: orgData?.cnpj,
          creci: orgData?.creci,
          legalAddress: orgData?.legalAddress,
        }}
        landingHref={landingHref}
      />
    </div>
  );
}
