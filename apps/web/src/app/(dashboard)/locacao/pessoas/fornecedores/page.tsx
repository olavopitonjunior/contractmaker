import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Wrench } from "lucide-react";
import { PessoasTable, type PessoaRow } from "@/components/locacao/PessoasTable";

export const dynamic = "force-dynamic";

/**
 * Fornecedores: ids distintos em Maintenance.fornecedorId + Expense.fornecedorId.
 * Resolvidos em PropertyOwner (campo polimórfico). Dedupe por id.
 */
export default async function FornecedoresPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const [maintenances, expenses] = await Promise.all([
    prisma.maintenance.findMany({
      where: { orgId: org.id, fornecedorId: { not: null } },
      select: { fornecedorId: true, status: true, custoFinal: true, tipo: true },
    }),
    prisma.expense.findMany({
      where: { orgId: org.id, fornecedorId: { not: null } },
      select: { fornecedorId: true, valor: true, status: true },
    }),
  ]);

  const fornecedorIds = new Set<string>();
  for (const m of maintenances) if (m.fornecedorId) fornecedorIds.add(m.fornecedorId);
  for (const e of expenses) if (e.fornecedorId) fornecedorIds.add(e.fornecedorId);

  const parties = await prisma.propertyOwner.findMany({
    where: { id: { in: Array.from(fornecedorIds) } },
    select: { id: true, nome: true, cpfCnpj: true, tipoPessoa: true, email: true, phone: true },
  });

  const partyMap = new Map(parties.map((p) => [p.id, p]));

  const rows: PessoaRow[] = parties.map((p) => {
    const manuts = maintenances.filter((m) => m.fornecedorId === p.id);
    const expsLen = expenses.filter((e) => e.fornecedorId === p.id).length;
    const totalManuts = manuts.reduce((acc, m) => acc + (m.custoFinal ?? 0), 0);
    return {
      id: p.id,
      nome: p.nome,
      cpfCnpj: p.cpfCnpj,
      tipoPessoa: p.tipoPessoa,
      email: p.email ?? "—",
      phone: p.phone ?? "—",
      vinculo: `${manuts.length} manutenção(ões) · ${expsLen} despesa(s) · R$ ${totalManuts.toFixed(0)} executado`,
      href: `/locacao/pessoas/proprietarios/${p.id}`,
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Fornecedores</h2>
        <p className="text-sm text-muted-foreground">
          {rows.length} fornecedor(es) com manutenções ou despesas vinculadas.
        </p>
      </div>

      <PessoasTable
        data={rows}
        emptyState={{
          icon: <Wrench className="h-10 w-10" />,
          title: "Nenhum fornecedor cadastrado",
          description:
            "Vincule um PropertyOwner como fornecedor em Maintenance ou Expense pra aparecer aqui.",
        }}
      />
    </div>
  );
}
