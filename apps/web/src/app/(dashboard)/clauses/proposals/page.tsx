import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ClauseProposalsClient } from "@/components/clauses/ClauseProposalsClient";

export default async function ClauseProposalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/clauses");

  const proposals = await prisma.clauseProposal.findMany({
    where: { orgId: org.id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return (
    <ClauseProposalsClient
      initialProposals={proposals.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        resolvedAt: p.resolvedAt?.toISOString() || null,
      }))}
    />
  );
}
