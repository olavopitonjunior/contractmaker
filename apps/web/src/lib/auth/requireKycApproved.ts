import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function requireKycApproved() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: org.id },
  });

  if (!account || account.status !== "APPROVED") {
    redirect("/financeiro");
  }

  return { session, org, account };
}
