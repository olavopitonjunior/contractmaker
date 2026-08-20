import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Users } from "lucide-react";
import { PessoasTable, type PessoaRow } from "@/components/locacao/PessoasTable";

export const dynamic = "force-dynamic";

export default async function ProprietariosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const owners = await prisma.propertyOwner.findMany({
    where: { orgId: org.id },
    include: {
      _count: { select: { ownerships: true } },
    },
    orderBy: { nome: "asc" },
    take: 500,
  });

  const rows: PessoaRow[] = owners.map((o) => ({
    id: o.id,
    nome: o.nome,
    cpfCnpj: o.cpfCnpj,
    tipoPessoa: o.tipoPessoa,
    email: o.email ?? "—",
    phone: o.phone ?? "—",
    vinculo: `${o._count.ownerships} imóvel(eis)`,
    href: `/locacao/pessoas/proprietarios/${o.id}`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Proprietários</h2>
          <p className="text-sm text-muted-foreground">
            {owners.length} cadastrado(s) ·{" "}
            {owners.filter((o) => o.tipoPessoa === "juridica").length} jurídica(s)
          </p>
        </div>
      </div>

      <PessoasTable
        data={rows}
        emptyState={{
          icon: <Users className="h-10 w-10" />,
          title: "Nenhum proprietário cadastrado",
          description:
            "Proprietários são criados ao cadastrar um imóvel com PropertyOwnership.",
        }}
      />
    </div>
  );
}
