import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ClipboardCheck } from "lucide-react";
import { VistoriasTable, type VistoriaRow } from "@/components/locacao/VistoriasTable";

export const dynamic = "force-dynamic";

export default async function LocacaoVistoriasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const inspections = await prisma.inspection.findMany({
    where: { orgId: org.id },
    include: {
      property: { select: { rua: true, numero: true, cidade: true, uf: true } },
      leaseContract: { select: { id: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

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
      <div>
        <h2 className="text-2xl font-semibold">Vistorias</h2>
        <p className="text-sm text-muted-foreground">
          {inspections.length} no total · {emCampo} em campo · {aguardandoAssinatura} aguardando assinatura. PWA do vistoriador em{" "}
          <code className="text-xs">/vistoria/[os]</code>.
        </p>
      </div>

      <VistoriasTable
        data={rows}
        emptyState={{
          icon: <ClipboardCheck className="h-10 w-10" />,
          title: "Sem vistorias",
          description: "Use POST /api/locacao/inspections ou Newton (agendar).",
        }}
      />
    </div>
  );
}
