import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Users } from "lucide-react";
import { NovoImovelDialog } from "@/components/locacao/NovoImovelDialog";

export const dynamic = "force-dynamic";

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  disponivel: "secondary",
  anunciado: "outline",
  em_negociacao: "outline",
  locado: "default",
  manutencao: "destructive",
  fora_catalogo: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  disponivel: "Disponível",
  anunciado: "Anunciado",
  em_negociacao: "Em negociação",
  locado: "Locado",
  manutencao: "Manutenção",
  fora_catalogo: "Fora do catálogo",
};

export default async function LocacaoImoveisPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const properties = await prisma.property.findMany({
    where: { orgId: org.id },
    include: {
      ownerships: { include: { owner: { select: { id: true, nome: true } } } },
      _count: { select: { leaseContracts: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const total = properties.length;
  const ativosCount = properties.filter((p) => p.status !== "fora_catalogo").length;
  const locadosCount = properties.filter((p) => p.status === "locado").length;
  const disponiveisCount = properties.filter((p) => p.status === "disponivel").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Imóveis</h2>
          <p className="text-sm text-muted-foreground">
            Catálogo. {total} no total · {ativosCount} ativos · {locadosCount} locados · {disponiveisCount} disponíveis.
          </p>
        </div>
        <NovoImovelDialog />
      </div>

      {properties.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum imóvel cadastrado ainda. Clique em <strong>Novo imóvel</strong> pra começar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {properties.map((p) => {
            const enderecoFmt = [
              [p.rua, p.numero].filter(Boolean).join(", "),
              p.bairro,
              [p.cidade, p.uf].filter(Boolean).join("/"),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Link
                key={p.id}
                href={`/locacao/imoveis/${p.id}`}
                className="group block focus:outline-none"
              >
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {p.kind.replace(/_/g, " ")} {p.area ? `· ${p.area} m²` : ""}
                      </CardTitle>
                      <Badge variant={STATUS_TONE[p.status] ?? "outline"}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="line-clamp-2">{enderecoFmt || "Endereço não preenchido"}</span>
                    </div>
                    {p.ownerships.length > 0 && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="line-clamp-2">
                          {p.ownerships
                            .map((o) => `${o.owner.nome} (${o.percentual}%)`)
                            .join(" · ")}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t pt-2">
                      <span className="text-xs text-muted-foreground">
                        {p._count.leaseContracts} contrato{p._count.leaseContracts !== 1 ? "s" : ""}
                      </span>
                      <span className="text-sm font-semibold">
                        {fmtBRL(p.valorAluguelSugerido)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
