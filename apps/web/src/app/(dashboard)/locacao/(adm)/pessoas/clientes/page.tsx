import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { UserPlus } from "lucide-react";
import { ClientesTable, type ClienteRow } from "@/components/locacao/ClientesTable";
import { NovoClienteDialog } from "@/components/locacao/NovoClienteDialog";
import { ImportarCrmDialog } from "@/components/locacao/ImportarCrmDialog";
import { LEASE_INSURERS, matchInsurerKey } from "@/lib/locacao/insurers";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const dynamic = "force-dynamic";

export default async function LocacaoClientesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  // Defesa em profundidade (feature Gerente): lista org-wide de clientes. Quem
  // só enxerga os deals atribuídos não vê a carteira inteira da imobiliária.
  const effUserId = await getEffectiveUserId(session.user.id);
  const effective = await getEffectivePermissions(effUserId, org.id);
  const restricted =
    can(effective, PERMISSION.DEAL_VIEW_ASSIGNED_ONLY) &&
    !can(effective, PERMISSION.DEAL_VIEW_ALL);
  const hasClientRead =
    can(effective, PERMISSION.CUSTOMER_VIEW_ALL) ||
    can(effective, PERMISSION.CLIENT_VIEW);
  if (restricted && !hasClientRead) redirect("/pipeline");

  const clients = await prisma.leaseClient.findMany({
    where: { orgId: org.id },
    include: {
      createdBy: { select: { name: true, email: true } },
      insurerAnalyses: { select: { seguradora: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows: ClienteRow[] = clients.map((c) => {
    return {
      id: c.id,
      nome: c.nome,
      cpfCnpj: c.cpfCnpj ?? "",
      tipoPessoa: c.tipoPessoa,
      phone: c.phone ?? "—",
      createdByName: c.createdBy?.name ?? c.createdBy?.email ?? "—",
      // Todas as seguradoras do roster com o status de cada (null = não enviado).
      insurers: LEASE_INSURERS.map((ins) => {
        const a = c.insurerAnalyses.find((x) => matchInsurerKey(x.seguradora) === ins.key);
        return { key: ins.key, label: ins.label, status: a?.status ?? null };
      }),
      href: `/locacao/pessoas/clientes/${c.id}`,
    };
  });

  const emAnalise = clients.filter((c) => c.status === "em_analise").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Clientes</h2>
          <p className="text-sm text-muted-foreground">
            {clients.length} cadastrado(s){emAnalise > 0 ? ` · ${emAnalise} em análise` : ""}. Leads e
            prospects com acompanhamento de crédito e fiança — dados do formulário são opcionais.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportarCrmDialog entity="cliente" />
          <NovoClienteDialog />
        </div>
      </div>

      <ClientesTable
        data={rows}
        emptyState={{
          icon: <UserPlus className="h-10 w-10" />,
          title: "Nenhum cliente cadastrado",
          description: 'Use "Novo cliente" ou "Importar do CRM" para começar.',
        }}
      />
    </div>
  );
}
