import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  isOrgOwner,
  userHasAccountCapability,
  maskWalletId,
} from "@/lib/asaas/account";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, KeyRound, FileText } from "lucide-react";
import { OnboardingWizard } from "@/components/financeiro/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  AWAITING_DOCS: "Aguardando documentos",
  AWAITING_APPROVAL: "Em análise",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  BLOCKED: "Bloqueada",
};

const SUBSTATUS_LABEL: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Pendente",
  AWAITING_APPROVAL: "Em análise",
  REJECTED: "Rejeitado",
  NOT_SENT: "Não enviado",
};

export default async function ContaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const { id } = await params;
  const owner = await isOrgOwner(session.user.id, org.id);

  // Non-owner precisa ter pelo menos cap "view"
  if (!owner) {
    const canView = await userHasAccountCapability(session.user.id, id, "view");
    if (!canView) redirect("/settings/pagamentos/contas");
  }

  const account = await prisma.asaasAccount.findFirst({
    where: { id, orgId: org.id },
    include: {
      documents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!account) notFound();

  const orgRow = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { activeAsaasAccountId: true },
  });
  const isActive = orgRow?.activeAsaasAccountId === id;

  const charges = await prisma.commissionCharge.count({
    where: { accountId: id },
  });
  const transfers = await prisma.asaasTransfer.count({
    where: { accountId: id },
  });

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
          <Link href="/settings/pagamentos/contas">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
          {account.label ?? `Conta ${account.id.slice(0, 8)}`}
          {isActive && <Badge variant="default">ATIVA</Badge>}
          {account.archivedAt && <Badge variant="outline">ARQUIVADA</Badge>}
        </h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Status</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Geral</div>
            <div className="font-medium">
              {STATUS_LABEL[account.status] ?? account.status}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Documentação</div>
            <div className="font-medium">
              {SUBSTATUS_LABEL[account.documentationStatus ?? ""] ??
                account.documentationStatus ??
                "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Comercial</div>
            <div className="font-medium">
              {SUBSTATUS_LABEL[account.commercialInfoStatus ?? ""] ??
                account.commercialInfoStatus ??
                "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Conta bancária</div>
            <div className="font-medium">
              {SUBSTATUS_LABEL[account.bankAccountInfoStatus ?? ""] ??
                account.bankAccountInfoStatus ??
                "—"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Identificadores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <div>
            <span className="text-muted-foreground">walletId:</span>{" "}
            <code>{maskWalletId(account.walletId)}</code>
          </div>
          <div>
            <span className="text-muted-foreground">asaasId:</span>{" "}
            <code>{account.asaasId}</code>
          </div>
          {account.accountNumber && (
            <div>
              <span className="text-muted-foreground">Conta:</span>{" "}
              <code>{account.accountNumber}</code>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Tipo:</span>{" "}
            {account.personType === "LEGAL" ? "PJ" : "PF"}
          </div>
          <div>
            <span className="text-muted-foreground">Criada em:</span>{" "}
            {account.createdAt.toLocaleDateString("pt-BR")}
          </div>
          {account.approvedAt && (
            <div>
              <span className="text-muted-foreground">Aprovada em:</span>{" "}
              {account.approvedAt.toLocaleDateString("pt-BR")}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wizard interativo de KYC: upload de docs + refresh de status.
          Pula quando aprovada (somente leitura). Owner-only escrita; non-owner
          com cap "view" só vê (wizard tem branches read-only). */}
      {account.status !== "APPROVED" && owner ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documentos KYC
            </CardTitle>
          </CardHeader>
          <CardContent>
            <OnboardingWizard mode="newAccount" accountId={account.id} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documentos KYC
            </CardTitle>
          </CardHeader>
          <CardContent>
            {account.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sem documentos listados pela Asaas.
              </p>
            ) : (
              <div className="space-y-2">
                {account.documents.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0"
                  >
                    <div>
                      <div className="font-medium">{d.title}</div>
                      {d.description && (
                        <div className="text-xs text-muted-foreground">
                          {d.description}
                        </div>
                      )}
                    </div>
                    <Badge
                      variant={
                        d.status === "APPROVED"
                          ? "default"
                          : d.status === "REJECTED"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {SUBSTATUS_LABEL[d.status] ?? d.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Atividade</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>
            <span className="text-muted-foreground">Cobranças:</span> {charges}
          </div>
          <div>
            <span className="text-muted-foreground">Transferências:</span>{" "}
            {transfers}
          </div>
        </CardContent>
      </Card>

      {owner && (
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link
              href={`/settings/pagamentos/contas/${account.id}/permissoes`}
            >
              <KeyRound className="h-4 w-4 mr-1" />
              Gerenciar permissões
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
