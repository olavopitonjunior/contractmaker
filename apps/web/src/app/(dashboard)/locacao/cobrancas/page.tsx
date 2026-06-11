import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Wallet } from "lucide-react";
import { CobrancasTable, type CobrancaRow } from "@/components/locacao/CobrancasTable";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function LocacaoCobrancasPage({
  searchParams,
}: {
  searchParams?: Promise<{ competencia?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const params = (await searchParams) ?? {};
  const competencia =
    params.competencia && /^\d{4}-\d{2}$/.test(params.competencia)
      ? params.competencia
      : undefined;
  const status = params.status;

  const charges = await prisma.rentCharge.findMany({
    where: {
      orgId: org.id,
      ...(competencia ? { competencia } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      leaseContract: {
        include: {
          property: { select: { rua: true, numero: true } },
          tenants: { include: { tenant: { select: { nome: true } } } },
        },
      },
    },
    orderBy: { dueDate: "desc" },
    take: 500,
  });

  const total = charges.reduce((acc, c) => acc + c.valorBase + c.encargos + c.multa + c.juros, 0);
  const pagas = charges.filter((c) => c.status === "paga" || c.status === "repassada").length;
  const atrasadas = charges.filter((c) => c.status === "atrasada").length;

  const rows: CobrancaRow[] = charges.map((c) => ({
    id: c.id,
    leaseContractId: c.leaseContractId,
    competencia: c.competencia,
    dueDate: c.dueDate.toISOString(),
    inquilino: c.leaseContract?.tenants[0]?.tenant.nome ?? "—",
    endereco: c.leaseContract?.property
      ? `${c.leaseContract.property.rua ?? ""} ${c.leaseContract.property.numero ?? ""}`.trim()
      : "—",
    kind: c.kind,
    totalValue: c.valorBase + c.encargos + c.multa + c.juros,
    status: c.status,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Cobranças de Aluguel</h2>
        <p className="text-sm text-muted-foreground">
          Lente sobre <code className="text-xs">/financeiro</code> filtrando{" "}
          <code className="text-xs">CommissionCharge.kind=&quot;aluguel&quot;</code> · {charges.length} cobranças ·{" "}
          {pagas} pagas · {atrasadas} atrasadas · total <strong>{fmtBRL(total)}</strong>
        </p>
      </div>

      <CobrancasTable
        data={rows}
        emptyState={{
          icon: <Wallet className="h-10 w-10" />,
          title: "Nenhuma cobrança ainda",
          description: "Cobranças são materializadas pelo cron /api/cron/rent/generate no dia 1 de cada mês.",
        }}
      />
    </div>
  );
}
