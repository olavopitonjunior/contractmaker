import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { UserCheck } from "lucide-react";
import { PessoasTable, type PessoaRow } from "@/components/locacao/PessoasTable";

export const dynamic = "force-dynamic";

export default async function LocatariosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const tenants = await prisma.tenant.findMany({
    where: { orgId: org.id },
    include: {
      _count: { select: { leaseTenants: true, creditAnalyses: true } },
    },
    orderBy: { nome: "asc" },
    take: 500,
  });

  const rows: PessoaRow[] = tenants.map((t) => ({
    id: t.id,
    nome: t.nome,
    cpfCnpj: t.cpfCnpj,
    tipoPessoa: t.tipoPessoa,
    email: t.email ?? "—",
    phone: t.phone ?? "—",
    vinculo: `${t._count.leaseTenants} contrato(s) · ${t._count.creditAnalyses} análise(s)`,
    href: `/locacao/pessoas/locatarios/${t.id}`,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Locatários</h2>
        <p className="text-sm text-muted-foreground">
          {tenants.length} cadastrado(s) ·{" "}
          {tenants.filter((t) => t.tipoPessoa === "juridica").length} jurídica(s)
        </p>
      </div>

      <PessoasTable
        data={rows}
        emptyState={{
          icon: <UserCheck className="h-10 w-10" />,
          title: "Nenhum locatário cadastrado",
          description: "Locatários são criados ao iniciar um deal de locação.",
        }}
      />
    </div>
  );
}
