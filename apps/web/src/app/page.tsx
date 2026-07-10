import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";
import { getOnboardingStatus } from "@/lib/onboarding/status";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (org) {
    // 1º acesso: o DONO (owner) que ainda não viu o modal de boas-vindas e com
    // onboarding incompleto é levado ao /onboarding UMA vez (o modal seta
    // onboardingIntroSeenAt). Depois disso o guia é o checklist na sidebar — sem
    // redirect forçado. Gate barato (flags no `org` já carregado + role).
    if (!org.onboardingCompletedAt && !org.onboardingIntroSeenAt) {
      const effUserId = await getEffectiveUserId(session.user.id);
      const membership = await prisma.orgMembership.findFirst({
        where: { userId: effUserId, orgId: org.id },
        select: { role: true },
      });
      if (membership?.role === "owner") {
        const status = await getOnboardingStatus(org.id);
        if (!status.complete) redirect("/onboarding");
      }
    }

    // Landing por módulo: tenant só-locação cai em /locacao; senão /pipeline.
    const modules = await getOrgModules(org.id);
    if (!isModuleEnabled(modules, MODULE.VENDAS) && isModuleEnabled(modules, MODULE.LOCACAO)) {
      redirect("/locacao");
    }
  }
  redirect("/pipeline");
}
