import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
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

  // Tenant só-locação (vendas off): o negócio nasce no board de locação, e a
  // landing pós-onboarding é /locacao; senão /pipeline.
  const locacaoOnly =
    !isModuleEnabled(modules, MODULE.VENDAS) && isModuleEnabled(modules, MODULE.LOCACAO);
  const landingHref = locacaoOnly ? "/locacao" : "/pipeline";

  return (
    <div className="mx-auto max-w-4xl">
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
        locacaoOnly={locacaoOnly}
        landingHref={landingHref}
      />
    </div>
  );
}
