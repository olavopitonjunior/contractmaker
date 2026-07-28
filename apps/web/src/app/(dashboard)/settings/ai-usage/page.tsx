import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { AIUsageClient } from "@/components/settings/AIUsageClient";
import { AiBudgetCard } from "@/components/settings/AiBudgetCard";
import { getOrgAiBudgetStatus } from "@/lib/ai/budget";
import { getEffectiveUserId } from "@/lib/auth/impersonation";

export const dynamic = "force-dynamic";

export default async function AIUsagePage() {
  const session = await auth();
  if (!session?.user) notFound();

  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  // Impersonation: sob "trocar de tenant", quem resolve membership/RBAC é o dono
  // do tenant, não o super_admin (ver lib/auth/impersonation.ts).
  const effUserId = await getEffectiveUserId(session.user.id);

  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  const canEditBudget = ["owner", "admin"].includes(membership?.role ?? "");

  const budget = await getOrgAiBudgetStatus(org.id);

  return (
    <div className="space-y-6">
      <AiBudgetCard
        initial={{ budgetUsd: budget.budgetUsd, spentUsd: budget.spentUsd }}
        canEdit={canEditBudget}
      />
      <AIUsageClient />
    </div>
  );
}
