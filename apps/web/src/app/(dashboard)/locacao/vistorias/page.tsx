import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck } from "lucide-react";

export const dynamic = "force-dynamic";

const TIPO_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  contra: "Contra-vistoria",
};

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  em_campo: "secondary",
  laudo_gerado: "default",
  assinatura: "secondary",
  concluida: "default",
};

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
    take: 100,
  });

  const emCampo = inspections.filter((i) => i.status === "em_campo").length;
  const aguardandoAssinatura = inspections.filter((i) => i.status === "assinatura").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Vistorias</h2>
        <p className="text-sm text-muted-foreground">
          {inspections.length} no total · {emCampo} em campo · {aguardandoAssinatura} aguardando assinatura. PWA do vistoriador em{" "}
          <code className="text-xs">/vistoria/[os]</code>.
        </p>
      </div>

      {inspections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Sem vistorias. Use <code className="text-xs">POST /api/locacao/inspections</code> ou Newton (agendar).
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {inspections.map((i) => {
                const enderecoFmt = i.property
                  ? [
                      [i.property.rua, i.property.numero].filter(Boolean).join(", "),
                      [i.property.cidade, i.property.uf].filter(Boolean).join("/"),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "—";
                return (
                  <li
                    key={i.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm hover:bg-muted/30"
                  >
                    <div className="col-span-2">
                      <Badge variant="outline">{TIPO_LABEL[i.tipo] ?? i.tipo}</Badge>
                    </div>
                    <div className="col-span-6">
                      <div className="font-medium">{enderecoFmt}</div>
                      <div className="text-xs text-muted-foreground">
                        Atualizada em {i.updatedAt.toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    <div className="col-span-2 text-xs text-muted-foreground">
                      {i.executorId ? `Vistor. ${i.executorId.slice(0, 6)}…` : "Sem vistoriador"}
                    </div>
                    <div className="col-span-2 text-right">
                      <Badge variant={STATUS_TONE[i.status] ?? "outline"}>{i.status}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
