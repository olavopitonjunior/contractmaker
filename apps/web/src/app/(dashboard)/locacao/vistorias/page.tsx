import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ClipboardCheck } from "lucide-react";
import { VistoriasTable, type VistoriaRow } from "@/components/locacao/VistoriasTable";
import { NovaVistoriaDialog } from "@/components/locacao/NovaVistoriaDialog";

export const dynamic = "force-dynamic";

function enderecoLabel(p: {
  rua: string | null;
  numero: string | null;
  cidade: string | null;
  uf: string | null;
}): string {
  return (
    [
      [p.rua, p.numero].filter(Boolean).join(", "),
      [p.cidade, p.uf].filter(Boolean).join("/"),
    ]
      .filter(Boolean)
      .join(" · ") || "Imóvel sem endereço"
  );
}

export default async function LocacaoVistoriasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const [inspections, properties, contracts] = await Promise.all([
    prisma.inspection.findMany({
      where: { orgId: org.id },
      include: {
        property: { select: { rua: true, numero: true, cidade: true, uf: true } },
        leaseContract: { select: { id: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.property.findMany({
      where: { orgId: org.id },
      select: { id: true, rua: true, numero: true, cidade: true, uf: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.leaseContract.findMany({
      where: { orgId: org.id },
      select: {
        id: true,
        property: { select: { rua: true, numero: true, cidade: true, uf: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);

  const propertyOptions = properties.map((p) => ({ id: p.id, label: enderecoLabel(p) }));
  const contractOptions = contracts.map((c) => ({
    id: c.id,
    label: c.property ? enderecoLabel(c.property) : "Contrato sem imóvel",
  }));

  const emCampo = inspections.filter((i) => i.status === "em_campo").length;
  const aguardandoAssinatura = inspections.filter((i) => i.status === "assinatura").length;

  const rows: VistoriaRow[] = inspections.map((i) => ({
    id: i.id,
    tipo: i.tipo,
    endereco: i.property
      ? [
          [i.property.rua, i.property.numero].filter(Boolean).join(", "),
          [i.property.cidade, i.property.uf].filter(Boolean).join("/"),
        ]
          .filter(Boolean)
          .join(" · ")
      : "—",
    executor: i.executorId ? `Vistor. ${i.executorId.slice(0, 6)}…` : "Sem vistoriador",
    updatedAt: i.updatedAt.toISOString(),
    status: i.status,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Vistorias</h2>
          <p className="text-sm text-muted-foreground">
            Vistorias de entrada e saída dos imóveis. {inspections.length} no total · {emCampo} em
            campo · {aguardandoAssinatura} aguardando assinatura.
          </p>
        </div>
        <NovaVistoriaDialog properties={propertyOptions} contracts={contractOptions} />
      </div>

      <VistoriasTable
        data={rows}
        emptyState={{
          icon: <ClipboardCheck className="h-10 w-10" />,
          title: "Nenhuma vistoria ainda",
          description: 'Agende a primeira pelo botão "Nova vistoria" acima.',
        }}
      />
    </div>
  );
}
