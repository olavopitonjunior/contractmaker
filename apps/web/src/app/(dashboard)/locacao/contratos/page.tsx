import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { FileText } from "lucide-react";
import { ContratosTable, type ContratoRow } from "@/components/locacao/ContratosTable";

export const dynamic = "force-dynamic";

export default async function LocacaoContratosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const contracts = await prisma.leaseContract.findMany({
    where: { orgId: org.id },
    include: {
      property: { select: { rua: true, numero: true, cidade: true, uf: true } },
      tenants: { include: { tenant: { select: { nome: true } } } },
      _count: { select: { rentCharges: true, expenses: true, checklists: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const ativos = contracts.filter((c) => c.status === "ativo").length;
  const rescisao = contracts.filter((c) => c.status === "rescisao").length;
  const renovacao = contracts.filter((c) => c.status === "renovacao").length;

  const rows: ContratoRow[] = contracts.map((lc) => ({
    id: lc.id,
    vencimento: lc.vigenciaFim ? lc.vigenciaFim.toISOString() : null,
    diaVencimento: lc.diaVencimento,
    endereco: lc.property
      ? [
          [lc.property.rua, lc.property.numero].filter(Boolean).join(", "),
          [lc.property.cidade, lc.property.uf].filter(Boolean).join("/"),
        ]
          .filter(Boolean)
          .join(" · ")
      : "—",
    inquilinos: lc.tenants.map((t) => t.tenant.nome).join(", ") || "sem inquilinos",
    aluguel: lc.valorAluguel,
    taxaAdm: lc.taxaAdminPercent,
    cobrancasCount: lc._count.rentCharges,
    despesasCount: lc._count.expenses,
    status: lc.status,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Contratos de Locação</h2>
        <p className="text-sm text-muted-foreground">
          {contracts.length} no total · {ativos} ativos · {renovacao} em renovação · {rescisao} em rescisão.
        </p>
      </div>

      <ContratosTable
        data={rows}
        emptyState={{
          icon: <FileText className="h-10 w-10" />,
          title: "Nenhum contrato",
          description:
            'Contratos são criados ao mover um deal pra "Chaves Entregues" na Esteira.',
        }}
      />
    </div>
  );
}
