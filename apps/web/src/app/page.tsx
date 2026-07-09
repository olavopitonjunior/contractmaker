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
    // Auto-launch do onboarding: só o DONO (owner) com setup incompleto e que
    // ainda não concluiu/pulou o tour cai no wizard guiado. Loop-safe porque
    // este redirect só roda na home "/" (rota irmã de /onboarding, que nunca
    // reexecuta o check). Checagem barata primeiro (role + flag) — o status
    // completo (várias queries) só roda pra owner não-dismissado.
    const effUserId = await getEffectiveUserId(session.user.id);
    const membership = await prisma.orgMembership.findFirst({
      where: { userId: effUserId, orgId: org.id },
      select: { role: true },
    });
    if (membership?.role === "owner") {
      const orgRow = await prisma.organization.findUnique({
        where: { id: org.id },
        select: { onboardingCompletedAt: true },
      });
      if (!orgRow?.onboardingCompletedAt) {
        const status = await getOnboardingStatus(org.id);
        if (!status.complete) redirect("/onboarding");
      }
    }

    // Landing por módulo: tenant só-locação (vendas desabilitado) cai em /locacao;
    // caso contrário, /pipeline (vendas). Evita o hop /pipeline→/locacao.
    const modules = await getOrgModules(org.id);
    if (!isModuleEnabled(modules, MODULE.VENDAS) && isModuleEnabled(modules, MODULE.LOCACAO)) {
      redirect("/locacao");
    }
  }
  redirect("/pipeline");
}
