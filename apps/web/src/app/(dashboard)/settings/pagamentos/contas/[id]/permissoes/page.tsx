import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { isOrgOwner } from "@/lib/asaas/account";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { AccountPermissionsEditor } from "@/components/settings/AccountPermissionsEditor";

export const dynamic = "force-dynamic";

export default async function PermissoesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const isOwner = await isOrgOwner(session.user.id, org.id);
  if (!isOwner) redirect("/settings/pagamentos/contas");

  const { id } = await params;
  const account = await prisma.asaasAccount.findFirst({
    where: { id, orgId: org.id },
  });
  if (!account) notFound();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
          <Link href={`/settings/pagamentos/contas/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Permissões — {account.label ?? `Conta ${account.id.slice(0, 8)}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          Libere capabilities específicas por usuário. O owner da organização
          tem acesso completo a todas as contas implicitamente.
        </p>
      </div>
      <AccountPermissionsEditor accountId={id} />
    </div>
  );
}
