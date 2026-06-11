import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Briefcase } from "lucide-react";
import { PessoasTable, type PessoaRow } from "@/components/locacao/PessoasTable";

export const dynamic = "force-dynamic";

/**
 * Corretores/Angariadores: PropertyOwner cadastrado como party em LeaseAngariador.
 * Dedupe por partyId; mostra quantidade de comissões recorrentes.
 */
export default async function CorretoresPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const angariadores = await prisma.leaseAngariador.findMany({
    where: { orgId: org.id },
    include: {
      party: { select: { id: true, nome: true, cpfCnpj: true, tipoPessoa: true, email: true, phone: true } },
    },
  });

  const byParty = new Map<
    string,
    {
      party: (typeof angariadores)[number]["party"];
      contratos: number;
      somaPercentual: number;
      somaValorFixo: number;
    }
  >();
  for (const a of angariadores) {
    const key = a.party.id;
    if (!byParty.has(key)) {
      byParty.set(key, {
        party: a.party,
        contratos: 0,
        somaPercentual: 0,
        somaValorFixo: 0,
      });
    }
    const entry = byParty.get(key)!;
    entry.contratos++;
    if (a.formaComissao === "percentual" && a.percentual) entry.somaPercentual += a.percentual;
    if (a.formaComissao === "valor_fixo" && a.valorFixo) entry.somaValorFixo += a.valorFixo;
  }

  const rows: PessoaRow[] = Array.from(byParty.values()).map((entry) => ({
    id: entry.party.id,
    nome: entry.party.nome,
    cpfCnpj: entry.party.cpfCnpj,
    tipoPessoa: entry.party.tipoPessoa,
    email: entry.party.email ?? "—",
    phone: entry.party.phone ?? "—",
    vinculo: `${entry.contratos} contrato(s) · ${entry.somaPercentual ? entry.somaPercentual.toFixed(1) + "% acum." : ""} ${entry.somaValorFixo ? `R$ ${entry.somaValorFixo.toFixed(0)} fixo` : ""}`.trim(),
    href: `/locacao/pessoas/proprietarios/${entry.party.id}`,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Corretores / Angariadores</h2>
        <p className="text-sm text-muted-foreground">
          {rows.length} captador(es) recebendo comissão recorrente sobre aluguel.
        </p>
      </div>

      <PessoasTable
        data={rows}
        emptyState={{
          icon: <Briefcase className="h-10 w-10" />,
          title: "Nenhum corretor com comissão recorrente",
          description:
            "Cadastre LeaseAngariador no detalhe do contrato pra registrar comissão recorrente.",
        }}
      />
    </div>
  );
}
