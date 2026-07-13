import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle, Calendar, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const TIPO_LABEL: Record<string, string> = {
  seguro_incendio: "Incêndio",
  seguro_fianca: "Fiança",
  conteudo: "Conteúdo",
  rd: "RD",
};

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ativa: "default",
  vencida: "destructive",
  cancelada: "outline",
  pendente: "secondary",
};

/**
 * Status efetivo: reconcilia o status armazenado com a vigência. Uma apólice cujo
 * `vigenciaFim` já passou está vencida na prática (salvo cancelada), independente
 * do `status` no banco. Mantém contagens (ativas/vencidas) e badge coerentes.
 */
function effectiveStatus(p: { status: string; vigenciaFim: Date }, now: Date): string {
  if (p.status === "cancelada") return "cancelada";
  if (p.vigenciaFim < now) return "vencida";
  return p.status;
}

export default async function SegurosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const now = new Date();
  const in60d = new Date(now.getTime() + 60 * 24 * 3600_000);

  const policies = await prisma.insurancePolicy.findMany({
    where: { orgId: org.id },
    include: {
      leaseContract: {
        include: {
          property: { select: { rua: true, numero: true, bairro: true, cidade: true, uf: true } },
          tenants: { include: { tenant: { select: { nome: true } } } },
        },
      },
      property: { select: { rua: true, numero: true, bairro: true, cidade: true, uf: true } },
    },
    orderBy: { vigenciaFim: "asc" },
    take: 500,
  });

  const ativas = policies.filter((p) => effectiveStatus(p, now) === "ativa");
  const vencendo = ativas.filter((p) => p.vigenciaFim <= in60d && p.vigenciaFim >= now);
  const vencidas = policies.filter((p) => effectiveStatus(p, now) === "vencida");
  const premioMensalSoma = ativas.reduce((acc, p) => acc + (p.premioMensal ?? 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Seguros</h2>
        <p className="text-sm text-muted-foreground">
          Apólices contratadas, cotações pendentes e faturas. Visão geral da carteira.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              Apólices ativas
            </div>
            <div className="text-xl font-semibold">{ativas.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              Vencem em 60 dias
            </div>
            <div className="text-xl font-semibold">{vencendo.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Vencidas
            </div>
            <div className="text-xl font-semibold">{vencidas.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Prêmio mensal total
            </div>
            <div className="text-xl font-semibold">{fmtBRL(premioMensalSoma)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="apolices">
        <TabsList>
          <TabsTrigger value="apolices">Apólices ({policies.length})</TabsTrigger>
          <TabsTrigger value="cotacoes">Cotações</TabsTrigger>
          <TabsTrigger value="faturas">Faturas</TabsTrigger>
          <TabsTrigger value="plano">Plano personalizado</TabsTrigger>
        </TabsList>

        <TabsContent value="apolices" className="mt-3">
          {policies.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Shield className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Nenhuma apólice cadastrada. Apólices são vinculadas a contratos ou imóveis.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="p-3">Tipo</th>
                        <th className="p-3">Seguradora</th>
                        <th className="p-3">Vinculado a</th>
                        <th className="p-3">Vigência</th>
                        <th className="p-3 text-right">Prêmio/mês</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policies.map((p) => {
                        const prop = p.leaseContract?.property ?? p.property;
                        const endereco = prop
                          ? [
                              [prop.rua, prop.numero].filter(Boolean).join(", "),
                              prop.bairro,
                              [prop.cidade, prop.uf].filter(Boolean).join("/"),
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "—";
                        const inquilinos =
                          p.leaseContract?.tenants
                            .map((t) => t.tenant.nome)
                            .join(", ") ?? null;
                        return (
                          <tr key={p.id} className="border-b last:border-b-0">
                            <td className="p-3">{TIPO_LABEL[p.tipo] ?? p.tipo}</td>
                            <td className="p-3 font-medium">{p.seguradora}</td>
                            <td className="p-3 text-xs">
                              {p.leaseContract ? (
                                <Link
                                  href={`/locacao/contratos/${p.leaseContract.id}`}
                                  className="text-primary hover:underline"
                                >
                                  {endereco}
                                  {inquilinos && (
                                    <div className="text-muted-foreground">{inquilinos}</div>
                                  )}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">{endereco}</span>
                              )}
                            </td>
                            <td className="p-3 whitespace-nowrap text-xs">
                              {p.vigenciaInicio.toLocaleDateString("pt-BR")} →{" "}
                              {p.vigenciaFim.toLocaleDateString("pt-BR")}
                            </td>
                            <td className="p-3 text-right">{fmtBRL(p.premioMensal)}</td>
                            <td className="p-3">
                              {(() => {
                                const eff = effectiveStatus(p, now);
                                return (
                                  <Badge variant={STATUS_TONE[eff] ?? "outline"}>{eff}</Badge>
                                );
                              })()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="cotacoes" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cotações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Integração com Tokio/Porto/Pottencial está no roadmap. Hoje cotações são
                solicitadas por WhatsApp.
              </p>
              <p className="text-xs">
                Quando integrarmos, esta aba lista cotações abertas com prazo, prêmio
                ofertado e CTA pra fechar/declinar.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faturas" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Faturas</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>
                Em breve: parcelas mensais de apólices ativas, status de pagamento, recibo
                e link pra repassar à fatura do inquilino (se responsavelPagamento =
                locatário).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plano" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plano personalizado</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>
                Em breve: simulador de combo Incêndio + Conteúdo + RD com desconto
                negociado por volume de carteira.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
