import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { HardHat } from "lucide-react";
import { PessoasTable, type PessoaRow } from "@/components/locacao/PessoasTable";

export const dynamic = "force-dynamic";

/**
 * Vistoriadores: ids distintos em Inspection.executorId.
 * Resolvidos em User. Mostra qtd de vistorias executadas + status agregados.
 */
export default async function VistoriadoresPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const inspections = await prisma.inspection.findMany({
    where: { orgId: org.id, executorId: { not: null } },
    select: { executorId: true, status: true },
  });

  const executorIds = Array.from(new Set(inspections.map((i) => i.executorId!).filter(Boolean)));
  const users = await prisma.user.findMany({
    where: { id: { in: executorIds } },
    select: { id: true, name: true, email: true },
  });

  const rows: PessoaRow[] = users.map((u) => {
    const insps = inspections.filter((i) => i.executorId === u.id);
    const concluidas = insps.filter((i) => i.status === "concluida").length;
    const emCampo = insps.filter((i) => i.status === "em_campo").length;
    return {
      id: u.id,
      nome: u.name ?? "Vistoriador",
      cpfCnpj: "—",
      tipoPessoa: "fisica",
      email: u.email ?? "—",
      phone: "—",
      vinculo: `${insps.length} vistoria(s) · ${concluidas} concluídas · ${emCampo} em campo`,
      href: "#",
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Vistoriadores</h2>
        <p className="text-sm text-muted-foreground">
          {rows.length} usuário(s) atuando como executor de vistoria.
        </p>
      </div>

      <PessoasTable
        data={rows}
        emptyState={{
          icon: <HardHat className="h-10 w-10" />,
          title: "Nenhum vistoriador registrado",
          description:
            "Vistoriadores aparecem aqui quando Inspection.executorId é setado.",
        }}
      />
    </div>
  );
}
