import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getOrgModules, homeHref } from "@/lib/modules/read";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { canSeeOnboarding } from "@/lib/onboarding/gate";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (org) {
    // 1º acesso: quem configura o tenant (owner/admin) e ainda não viu o modal de
    // boas-vindas, com onboarding incompleto, é levado ao /onboarding UMA vez (o
    // modal seta onboardingIntroSeenAt). Depois disso o guia é o checklist na
    // sidebar — sem redirect forçado. Gate barato (flags no `org` já carregado + role).
    if (!org.onboardingCompletedAt && !org.onboardingIntroSeenAt) {
      if (await canSeeOnboarding(session.user.id, org.id)) {
        const status = await getOnboardingStatus(org.id);
        if (!status.complete) redirect("/onboarding");
      }
    }

    // Landing por entitlement (homeHref): kanban de vendas → kanban de locação
    // → perfil. O antigo redirect pra /locacao virou loop quando locacao.adm
    // passou a default OFF (2026-08-20).
    const modules = await getOrgModules(org.id);
    redirect(homeHref(modules));
  }
  redirect("/pipeline");
}
