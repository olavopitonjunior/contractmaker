import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import {
  listAccessibleAccounts,
  resolveAsaasAccount,
  maskWalletId,
} from "@/lib/asaas/account";
import { AccountSwitcher } from "@/components/financeiro/AccountSwitcher";

export const dynamic = "force-dynamic";

/**
 * Gate do módulo financeiro: o user precisa ter acesso a pelo menos uma
 * AsaasAccount com status APPROVED. Multi-account: substitui o lookup
 * `findUnique({ orgId })` antigo. Owner herda acesso a todas as contas;
 * non-owner depende de grants em AsaasAccountPermission.
 *
 * Renderiza AccountSwitcher no topo de todas as sub-rotas /financeiro/*
 * (oculto na página raiz quando ela não está em modo aprovado).
 */
export default async function FinanceiroLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  // Gate de módulo: financeiro/pagadoria pertence a Vendas. Tenant só-locação
  // (feature OFF) é redirecionado pra /locacao — antes de qualquer lookup Asaas.
  const modules = await getOrgModules(org.id);
  if (!isFeatureEnabled(modules, FEATURE.VENDAS_PAGADORIA)) redirect("/locacao");

  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";

  const accessible = await listAccessibleAccounts(session.user.id, org.id);
  const approved = accessible.some((a) => a.status === "APPROVED");

  if (!approved) {
    const isGatePath =
      pathname === "/financeiro" ||
      pathname.startsWith("/financeiro/onboarding");
    if (!isGatePath) {
      redirect("/financeiro");
    }
    return <>{children}</>;
  }

  // Não duplica switcher na página raiz e na onboarding
  // (a raiz já renderiza um próprio com label de wallet).
  const showSwitcher =
    pathname !== "/financeiro" && !pathname.startsWith("/financeiro/onboarding");

  let switcherProps:
    | { currentAccountId: string; accounts: Array<{ id: string; label: string; walletIdMasked: string; isActive: boolean }> }
    | null = null;
  if (showSwitcher) {
    const orgRow = await prisma.organization.findUnique({
      where: { id: org.id },
      select: { activeAsaasAccountId: true },
    });
    const resolved = await resolveAsaasAccount({
      userId: session.user.id,
      orgId: org.id,
      requireCapability: "view",
    });
    if (resolved) {
      switcherProps = {
        currentAccountId: resolved.account.id,
        accounts: accessible
          .filter((a) => a.status === "APPROVED")
          .map((a) => ({
            id: a.id,
            label: a.label ?? `Conta ${a.id.slice(0, 6)}`,
            walletIdMasked: maskWalletId(a.walletId),
            isActive: a.id === orgRow?.activeAsaasAccountId,
          })),
      };
    }
  }

  return (
    <>
      {switcherProps && (
        <div className="flex justify-end mb-3">
          <AccountSwitcher {...switcherProps} />
        </div>
      )}
      {children}
    </>
  );
}
