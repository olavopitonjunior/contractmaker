import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { listAccessibleAccounts } from "@/lib/asaas/account";

/**
 * Gate de KYC aprovado: redireciona pra /financeiro se o user não tem
 * acesso a nenhuma AsaasAccount com status APPROVED.
 *
 * Multi-account: substitui o lookup `findUnique({ orgId })` antigo. Owner vê
 * todas as contas; non-owner vê apenas contas em que tem ≥1 grant.
 */
export async function requireKycApproved() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const accessible = await listAccessibleAccounts(session.user.id, org.id);
  const approvedAccount = accessible.find((a) => a.status === "APPROVED");

  if (!approvedAccount) {
    redirect("/financeiro");
  }

  // Resolve a conta "em foco": prefere a ativa da org se for APPROVED + acessível,
  // senão a primeira APPROVED acessível.
  const orgRow = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { activeAsaasAccountId: true },
  });
  const activeAccount = accessible.find(
    (a) => a.id === orgRow?.activeAsaasAccountId && a.status === "APPROVED"
  );
  const account = activeAccount ?? approvedAccount;

  return { session, org, account };
}
