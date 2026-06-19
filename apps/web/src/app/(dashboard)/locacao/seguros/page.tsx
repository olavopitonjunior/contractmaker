import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle, Calendar, FileText, Bot, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const TIPO_LABEL: Record<string, string> = {
  seguro_incendio: "Incêndio",
  seguro_fianca: "Fiança",
  conteudo: "Conteúdo",
  rd: "RD",
};

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  cotacao: "secondary",
  em_analise: "secondary",
  pendente: "secondary",
  ativa: "default",
  vencida: "destructive",
  cancelada: "outline",
};

const GUARANTEE_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pendente: "secondary",
  em_analise: "secondary",
  aprovada: "default",
  vigente: "default",
  ativa: "default",
  executada: "destructive",
  acionada: "destructive",
  finalizada: "outline",
  encerrada: "outline",
  recusada: "destructive",
};

const CREDIT_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pendente: "secondary",
  aprovado: "default",
  aprovado_com_garantia: "outline",
  analise_manual: "secondary",
  recusado: "destructive",
};

const CREDIT_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  aprovado_com_garantia: "Aprovado c/ garantia",
  analise_manual: "Análise manual",
  recusado: "Recusado",
};

/** Status efetivo: reconcilia o status armazenado com a vigência. */
function effectiveStatus(p: { status: string; vigenciaFim: Date }, now: Date): string {
  if (p.status === "cancelada") return "cancelada";
  if (p.vigenciaFim < now) return "vencida";
  return p.status;
}

function enderecoOf(prop: { rua: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null } | null | undefined): string {
  if (!prop) return "—";
  return [
    [prop.rua, prop.numero].filter(Boolean).join(", "),
    prop.bairro,
    [prop.cidade, prop.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");
}

export default async function SegurosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const now = new Date();
  const in60d = new Date(now.getTime() + 60 * 24 * 3600_000);
  const in90d = new Date(now.getTime() + 90 * 24 * 3600_000);

  const propSelect = { select: { rua: true, numero: true, bairro: true, cidade: true, uf: true } } as const;

  const [policies, guarantees, creditAnalyses] = await Promise.all([
    prisma.insurancePolicy.findMany({
      where: { orgId: org.id },
      include: {
        leaseContract: {
          include: {
            property: propSelect,
            tenants: { include: { tenant: { select: { nome: true } } } },
          },
        },
        property: propSelect,
      },
      orderBy: { vigenciaFim: "asc" },
      take: 500,
    }),
    prisma.guarantee.findMany({
      where: { orgId: org.id, tipo: "seguro_fianca" },
      include: { leaseContract: { include: { property: propSelect } } },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    prisma.creditAnalysis.findMany({
      where: { orgId: org.id },
      include: { tenant: { select: { nome: true } } },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
  ]);

  // Apólices "firmes" (não cotação) vs cotações/testes registrados pelo Max.
  const apolices = policies.filter((p) => p.status !== "cotacao");
  const cotacoes = policies.filter((p) => p.status === "cotacao");

  const ativas = policies.filter((p) => effectiveStatus(p, now) === "ativa");
  const vencendo = ativas.filter((p) => p.vigenciaFim <= in60d && p.vigenciaFim >= now);
  const vencidas = policies.filter((p) => effectiveStatus(p, now) === "vencida");
  const renovacoes = ativas
    .filter((p) => p.vigenciaFim <= in90d && p.vigenciaFim >= now)
    .sort((a, b) => a.vigenciaFim.getTime() - b.vigenciaFim.getTime());
  const premioMensalSoma = ativas.reduce((acc, p) => acc + (p.premioMensal ?? 0), 0);

  function fonteBadge(origem: string, externalRef: string | null) {
    const isMax = origem === "api" || Boolean(externalRef);
    return isMax ? (
      <Badge variant="secondary" className="gap-1">
        <Bot className="h-3 w-3" /> Max
      </Badge>
    ) : (
      <Badge variant="outline">Manual</Badge>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Seguros</h2>
        <p className="text-sm text-muted-foreground">
          Apólices, cotações/testes do Max e análises de fiança. Visão da carteira.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" /> Apólices ativas
            </div>
            <div className="text-xl font-semibold">{ativas.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className={`flex items-center gap-2 text-xs ${vencendo.length > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
              <Calendar className="h-3.5 w-3.5" /> Vencem em 60 dias
            </div>
            <div className={`text-xl font-semibold ${vencendo.length > 0 ? "text-amber-600" : ""}`}>{vencendo.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className={`flex items-center gap-2 text-xs ${vencidas.length > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Vencidas
            </div>
            <div className="text-xl font-semibold">{vencidas.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" /> Prêmio mensal total
            </div>
            <div className="text-xl font-semibold">{fmtBRL(premioMensalSoma)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bot className="h-3.5 w-3.5" /> Cotações do Max
            </div>
            <div className="text-xl font-semibold">{cotacoes.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="apolices">
        <TabsList>
          <TabsTrigger value="apolices">Apólices ({apolices.length})</TabsTrigger>
          <TabsTrigger value="cotacoes">Cotações / Testes ({cotacoes.length})</TabsTrigger>
          <TabsTrigger value="garantias">Garantias / Fiança ({guarantees.length})</TabsTrigger>
          <TabsTrigger value="renovacoes">Renovações ({renovacoes.length})</TabsTrigger>
        </TabsList>

        {/* APÓLICES */}
        <TabsContent value="apolices" className="mt-3">
          {apolices.length === 0 ? (
            <EmptyCard icon="shield" text="Nenhuma apólice firme. Apólices vinculam-se a contratos ou imóveis." />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="p-3">Tipo</th>
                      <th className="p-3">Seguradora</th>
                      <th className="p-3">Fonte</th>
                      <th className="p-3">Vinculado a</th>
                      <th className="p-3">Vigência</th>
                      <th className="p-3 text-right">Prêmio/mês</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apolices.map((p) => {
                      const prop = p.leaseContract?.property ?? p.property;
                      const inquilinos = p.leaseContract?.tenants.map((t) => t.tenant.nome).join(", ") ?? null;
                      const eff = effectiveStatus(p, now);
                      return (
                        <tr key={p.id} className="border-b last:border-b-0">
                          <td className="p-3">{TIPO_LABEL[p.tipo] ?? p.tipo}</td>
                          <td className="p-3 font-medium">{p.seguradora}</td>
                          <td className="p-3">{fonteBadge(p.origem, p.externalRef)}</td>
                          <td className="p-3 text-xs">
                            {p.leaseContract ? (
                              <Link href={`/locacao/contratos/${p.leaseContract.id}`} className="text-primary hover:underline">
                                {enderecoOf(prop)}
                                {inquilinos && <div className="text-muted-foreground">{inquilinos}</div>}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">{enderecoOf(prop)}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap p-3 text-xs">
                            {fmtDate(p.vigenciaInicio)} → {fmtDate(p.vigenciaFim)}
                          </td>
                          <td className="p-3 text-right">{fmtBRL(p.premioMensal)}</td>
                          <td className="p-3">
                            <Badge variant={STATUS_TONE[eff] ?? "outline"}>{eff}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* COTAÇÕES / TESTES (gravadas pelo Max) */}
        <TabsContent value="cotacoes" className="mt-3">
          {cotacoes.length === 0 ? (
            <EmptyCard icon="bot" text="Nenhuma cotação registrada pelo Max ainda." sub="Cotações aparecem aqui quando o Max simula incêndio via WhatsApp." />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="p-3">Ramo</th>
                      <th className="p-3">Seguradora</th>
                      <th className="p-3">Fonte</th>
                      <th className="p-3">Vinculado a</th>
                      <th className="p-3">Criado</th>
                      <th className="p-3 text-right">Prêmio/mês</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cotacoes.map((p) => {
                      const prop = p.leaseContract?.property ?? p.property;
                      return (
                        <tr key={p.id} className="border-b last:border-b-0">
                          <td className="p-3">
                            <Badge variant="outline">{TIPO_LABEL[p.tipo] ?? p.tipo}</Badge>
                          </td>
                          <td className="p-3 font-medium">{p.seguradora}</td>
                          <td className="p-3">{fonteBadge(p.origem, p.externalRef)}</td>
                          <td className="p-3 text-xs">
                            {p.leaseContract ? (
                              <Link href={`/locacao/contratos/${p.leaseContract.id}`} className="text-primary hover:underline">
                                {enderecoOf(prop)}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">{enderecoOf(prop)}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap p-3 text-xs">{fmtDate(p.createdAt)}</td>
                          <td className="p-3 text-right">{fmtBRL(p.premioMensal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* GARANTIAS / FIANÇA (Guarantee + CreditAnalysis) */}
        <TabsContent value="garantias" className="mt-3 space-y-4">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" /> Garantias de fiança
            </h3>
            {guarantees.length === 0 ? (
              <EmptyCard icon="shield" text="Nenhuma garantia de seguro-fiança registrada." />
            ) : (
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="p-3">Fonte</th>
                        <th className="p-3">Contrato</th>
                        <th className="p-3">Cobertura</th>
                        <th className="p-3 text-right">Custo/mês</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guarantees.map((g) => {
                        const custo = (g.custoJson ?? null) as { premioMensal?: number } | null;
                        return (
                          <tr key={g.id} className="border-b last:border-b-0">
                            <td className="p-3 font-medium">{g.provider ?? "—"}</td>
                            <td className="p-3 text-xs">
                              <Link href={`/locacao/contratos/${g.leaseContractId}`} className="text-primary hover:underline">
                                {enderecoOf(g.leaseContract?.property)}
                              </Link>
                            </td>
                            <td className="p-3 text-xs">{g.coberturaMeses ? `${g.coberturaMeses} meses` : "—"}</td>
                            <td className="p-3 text-right">{fmtBRL(custo?.premioMensal)}</td>
                            <td className="p-3">
                              <Badge variant={GUARANTEE_TONE[g.status] ?? "outline"}>{g.status}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Análises de crédito</h3>
            {creditAnalyses.length === 0 ? (
              <EmptyCard icon="bot" text="Nenhuma análise de crédito registrada." />
            ) : (
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="p-3">Pretendente</th>
                        <th className="p-3">Decidido em</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditAnalyses.map((c) => (
                        <tr key={c.id} className="border-b last:border-b-0">
                          <td className="p-3">{c.tenant?.nome ?? "—"}</td>
                          <td className="whitespace-nowrap p-3 text-xs">{fmtDate(c.updatedAt)}</td>
                          <td className="p-3">
                            <Badge variant={CREDIT_TONE[c.status] ?? "outline"}>{CREDIT_LABEL[c.status] ?? c.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* RENOVAÇÕES */}
        <TabsContent value="renovacoes" className="mt-3">
          {renovacoes.length === 0 ? (
            <EmptyCard icon="calendar" text="Nenhuma apólice ativa vencendo nos próximos 90 dias." />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="p-3">Tipo</th>
                      <th className="p-3">Seguradora</th>
                      <th className="p-3">Imóvel</th>
                      <th className="p-3">Vence em</th>
                      <th className="p-3 text-right">Prêmio/mês</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renovacoes.map((p) => {
                      const dias = Math.ceil((p.vigenciaFim.getTime() - now.getTime()) / (24 * 3600_000));
                      const prop = p.leaseContract?.property ?? p.property;
                      return (
                        <tr key={p.id} className="border-b last:border-b-0">
                          <td className="p-3">{TIPO_LABEL[p.tipo] ?? p.tipo}</td>
                          <td className="p-3 font-medium">{p.seguradora}</td>
                          <td className="p-3 text-xs text-muted-foreground">{enderecoOf(prop)}</td>
                          <td className={`p-3 text-xs ${dias < 30 ? "text-amber-600" : ""}`}>{dias} dia(s)</td>
                          <td className="p-3 text-right">{fmtBRL(p.premioMensal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyCard({ icon, text, sub }: { icon: "shield" | "bot" | "calendar"; text: string; sub?: string }) {
  const Icon = icon === "bot" ? Bot : icon === "calendar" ? Calendar : Shield;
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Icon className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">{text}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
