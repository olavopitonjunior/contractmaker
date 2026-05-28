import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Building2 } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  assinatura: "secondary",
  ativo: "default",
  renovacao: "secondary",
  rescisao: "destructive",
  encerrado: "outline",
};

export default async function LocacaoContratosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const contracts = await prisma.leaseContract.findMany({
    where: { orgId: org.id },
    include: {
      property: { select: { rua: true, numero: true, cidade: true, uf: true } },
      tenants: { include: { tenant: { select: { nome: true } } } },
      _count: { select: { rentCharges: true, expenses: true, checklists: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const ativos = contracts.filter((c) => c.status === "ativo").length;
  const rescisao = contracts.filter((c) => c.status === "rescisao").length;
  const renovacao = contracts.filter((c) => c.status === "renovacao").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Contratos de Locação</h2>
        <p className="text-sm text-muted-foreground">
          {contracts.length} no total · {ativos} ativos · {renovacao} em renovação · {rescisao} em rescisão.
        </p>
      </div>

      {contracts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum contrato. Contratos são criados ao mover deal pra <strong>Chaves Entregues</strong> na Esteira.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Vencimento · Contrato · Aluguel
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {contracts.map((lc) => {
                const endereco = lc.property
                  ? [
                      [lc.property.rua, lc.property.numero].filter(Boolean).join(", "),
                      [lc.property.cidade, lc.property.uf].filter(Boolean).join("/"),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "—";
                return (
                  <li key={lc.id}>
                    <Link
                      href={`/locacao/contratos/${lc.id}`}
                      className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-muted/40"
                    >
                      <div className="col-span-2 text-sm">
                        <div className="font-medium">
                          {lc.vigenciaFim
                            ? lc.vigenciaFim.toLocaleDateString("pt-BR")
                            : "Indeterminado"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          dia {lc.diaVencimento}
                        </div>
                      </div>
                      <div className="col-span-6 text-sm">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {endereco}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {lc.tenants.map((t) => t.tenant.nome).join(", ") ||
                            "sem inquilinos"}
                        </div>
                      </div>
                      <div className="col-span-2 text-sm">
                        <div className="font-semibold">{fmtBRL(lc.valorAluguel)}</div>
                        <div className="text-xs text-muted-foreground">
                          Taxa adm {lc.taxaAdminPercent}%
                        </div>
                      </div>
                      <div className="col-span-2 flex items-center justify-end gap-2">
                        <span className="text-xs text-muted-foreground">
                          {lc._count.rentCharges} cob · {lc._count.expenses} desp
                        </span>
                        <Badge variant={STATUS_TONE[lc.status] ?? "outline"}>
                          {lc.status}
                        </Badge>
                      </div>
                    </Link>
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
