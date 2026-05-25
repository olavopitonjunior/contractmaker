import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  isOrgOwner,
  listAccessibleAccounts,
  maskWalletId,
} from "@/lib/asaas/account";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, Plus, KeyRound, Archive, Settings as SettingsIcon } from "lucide-react";
import { AccountsTableActions } from "@/components/settings/AccountsTableActions";
import { RecoverOrphanButton } from "@/components/settings/RecoverOrphanButton";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Pendente", color: "bg-amber-100 text-amber-800" },
  AWAITING_DOCS: { label: "Aguardando docs", color: "bg-amber-100 text-amber-800" },
  AWAITING_APPROVAL: { label: "Em análise", color: "bg-blue-100 text-blue-800" },
  APPROVED: { label: "Aprovada", color: "bg-green-100 text-green-800" },
  REJECTED: { label: "Rejeitada", color: "bg-red-100 text-red-800" },
  BLOCKED: { label: "Bloqueada", color: "bg-red-100 text-red-800" },
};

export default async function ContasBancariasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const isOwner = await isOrgOwner(session.user.id, org.id);
  const accounts = await listAccessibleAccounts(session.user.id, org.id);
  const orgRow = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { activeAsaasAccountId: true },
  });

  const counts = await prisma.commissionCharge.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _count: true,
  });
  const countByAccount = new Map(
    counts.map((c) => [c.accountId ?? "", c._count])
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Wallet className="h-6 w-6" />
            Contas bancárias Asaas
          </h1>
          <p className="text-sm text-muted-foreground">
            Cada conta tem seu próprio saldo, KYC e configurações financeiras.
            A conta marcada como <strong>ATIVA</strong> é o destino default
            das novas cobranças.
          </p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            <RecoverOrphanButton />
            <Button asChild>
              <Link href="/settings/pagamentos/contas/nova">
                <Plus className="h-4 w-4 mr-1" />
                Nova conta
              </Link>
            </Button>
          </div>
        )}
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Wallet className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma conta bancária criada ainda.
            </p>
            {isOwner && (
              <Button asChild>
                <Link href="/settings/pagamentos/contas/nova">
                  <Plus className="h-4 w-4 mr-1" />
                  Criar primeira conta
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {accounts.map((a) => {
            const isActive = a.id === orgRow?.activeAsaasAccountId;
            const statusInfo = STATUS_LABEL[a.status] ?? {
              label: a.status,
              color: "bg-gray-100 text-gray-800",
            };
            return (
              <Card key={a.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {a.label ?? `Conta ${a.id.slice(0, 8)}`}
                      {isActive && (
                        <Badge variant="default" className="text-[10px]">
                          ATIVA
                        </Badge>
                      )}
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded ${statusInfo.color}`}
                      >
                        {statusInfo.label}
                      </span>
                      {a.archivedAt && (
                        <Badge variant="outline" className="text-[10px]">
                          ARQUIVADA
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      walletId{" "}
                      <code className="text-xs">{maskWalletId(a.walletId)}</code>
                      {a.accountNumber && ` · ${a.accountNumber}`}
                      {" · "}
                      {a.personType === "LEGAL" ? "PJ" : "PF"}
                      {" · "}
                      {countByAccount.get(a.id) ?? 0} cobrança
                      {(countByAccount.get(a.id) ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>
                  {isOwner && (
                    <AccountsTableActions
                      accountId={a.id}
                      label={a.label}
                      status={a.status}
                      isActive={isActive}
                      isArchived={!!a.archivedAt}
                    />
                  )}
                </CardHeader>
                <CardContent className="pt-2 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/settings/pagamentos/contas/${a.id}`}>
                      <SettingsIcon className="h-4 w-4 mr-1" />
                      Detalhes & KYC
                    </Link>
                  </Button>
                  {isOwner && (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/settings/pagamentos/contas/${a.id}/permissoes`}
                      >
                        <KeyRound className="h-4 w-4 mr-1" />
                        Permissões
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Como funciona
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Cada cobrança fica vinculada permanentemente à conta que a emitiu.
            Trocar a conta ativa não migra cobranças em aberto — só novas
            cobranças passam a usar a nova conta como destino default.
          </p>
          <p>
            Permissões granulares (visualizar / criar cobrança / iniciar
            transferência / configurar) são liberadas por usuário e por conta.
            O proprietário (owner) tem acesso completo a todas as contas
            implicitamente.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
