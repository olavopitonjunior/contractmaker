import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ShieldUser } from "lucide-react";
import { PessoasTable, type PessoaRow } from "@/components/locacao/PessoasTable";

export const dynamic = "force-dynamic";

interface FiadorJson {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  tipo_pessoa?: string;
}

/**
 * Fiadores são extraídos de Guarantee.fiadorPartyJson (não há entity dedicada).
 * Agrupamento por CPF/CNPJ + dedupe. Vínculo = quantos contratos.
 */
export default async function FiadoresPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const guarantees = await prisma.guarantee.findMany({
    where: {
      orgId: org.id,
      tipo: "fiador",
      fiadorPartyJson: { not: { equals: null } },
    },
    select: { fiadorPartyJson: true, leaseContractId: true, status: true },
  });

  const byKey = new Map<
    string,
    { fiador: FiadorJson; contratos: number; ativos: number }
  >();
  for (const g of guarantees) {
    const fiador = (g.fiadorPartyJson ?? {}) as FiadorJson;
    const key = fiador.cpf || fiador.cnpj || fiador.nome || "—";
    if (!byKey.has(key)) {
      byKey.set(key, { fiador, contratos: 0, ativos: 0 });
    }
    const entry = byKey.get(key)!;
    entry.contratos++;
    if (g.status === "ativa") entry.ativos++;
  }

  const rows: PessoaRow[] = Array.from(byKey.entries()).map(([key, entry], idx) => ({
    id: `fiador-${idx}-${key.slice(0, 12)}`,
    nome: entry.fiador.nome ?? "Fiador sem nome",
    cpfCnpj: entry.fiador.cpf ?? entry.fiador.cnpj ?? "—",
    tipoPessoa: entry.fiador.tipo_pessoa ?? (entry.fiador.cnpj ? "juridica" : "fisica"),
    email: entry.fiador.email ?? "—",
    phone: entry.fiador.phone ?? "—",
    vinculo: `${entry.contratos} contrato(s) · ${entry.ativos} ativos`,
    // Sem ficha individual (não há entity própria). Link pra search no command palette.
    href: `#`,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Fiadores</h2>
        <p className="text-sm text-muted-foreground">
          {rows.length} pessoa(s) atuando como fiador em contratos da org. Origem:{" "}
          <code className="text-xs">Guarantee.fiadorPartyJson</code> (sem entity dedicada).
        </p>
      </div>

      <PessoasTable
        data={rows}
        emptyState={{
          icon: <ShieldUser className="h-10 w-10" />,
          title: "Nenhum fiador cadastrado",
          description:
            'Fiadores aparecem aqui quando contratos usam garantia tipo "fiador".',
        }}
      />
    </div>
  );
}
