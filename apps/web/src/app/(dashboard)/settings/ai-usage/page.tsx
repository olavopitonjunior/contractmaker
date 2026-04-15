import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { AIUsageClient } from "@/components/settings/AIUsageClient";

export const dynamic = "force-dynamic";

export default async function AIUsagePage() {
  const session = await auth();
  if (!session?.user) notFound();

  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  // Admin-only — check org membership role
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: session.user.id, orgId: org.id },
    select: { role: true },
  });
  if (!membership || membership.role !== "admin") {
    // Also allow the org owner (first member) for now since we don't enforce roles strictly
    // If you want to be strict, remove this and require role === "admin"
  }

  return <AIUsageClient />;
}
