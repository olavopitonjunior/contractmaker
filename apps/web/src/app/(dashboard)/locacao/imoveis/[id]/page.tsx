import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, Building2 } from "lucide-react";
import { AIInsightsCard } from "@/components/ai-assist/InsightsCard";
import { ExtratoImovelCard } from "@/components/locacao/ExtratoImovelCard";

export const dynamic = "force-dynamic";

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface Params {
  params: Promise<{ id: string }>;
}

export default async function PropertyDetailPage({ params }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");
  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, orgId: org.id },
    include: {
      ownerships: { include: { owner: true } },
      leaseContracts: {
        select: {
          id: true,
          status: true,
          valorAluguel: true,
          vigenciaInicio: true,
          vigenciaFim: true,
          tenants: { include: { tenant: { select: { nome: true } } } },
        },
      },
      insurancePolicies: true,
      maintenances: { orderBy: { abertaEm: "desc" }, take: 10 },
      expenses: { orderBy: { dueDate: "desc" }, take: 10 },
    },
  });
  if (!property) notFound();

  const endereco = [
    [property.rua, property.numero].filter(Boolean).join(", "),
    property.bairro,
    [property.cidade, property.uf].filter(Boolean).join("/"),
    property.cep,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <Link
        href="/locacao/imoveis"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para imóveis
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Building2 className="mt-1 h-6 w-6" />
          <div>
            <h2 className="text-2xl font-semibold">
              {property.kind.replace(/_/g, " ")} {property.area ? `· ${property.area} m²` : ""}
            </h2>
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> {endereco || "Sem endereço"}
            </p>
          </div>
        </div>
        <Badge variant="outline">{property.status}</Badge>
      </div>

      <AIInsightsCard context="property" contextId={property.id} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do imóvel</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Matrícula" value={property.matricula} />
            <Field label="Cartório" value={property.cartorio} />
            <Field label="Inscrição IPTU" value={property.inscricaoIptu} />
            <Field label="Tipo DIMOB" value={property.tipoDimob} />
            <Field label="Valor aluguel sugerido" value={fmtBRL(property.valorAluguelSugerido)} />
            <Field label="Área" value={property.area ? `${property.area} m²` : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Proprietários & beneficiários</CardTitle>
          </CardHeader>
          <CardContent>
            {property.ownerships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum proprietário vinculado. Use{" "}
                <code className="text-xs">PUT /api/locacao/properties/{id}/ownership</code> para
                definir (soma dos % = 100).
              </p>
            ) : (
              <ul className="divide-y">
                {property.ownerships.map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">{o.owner.nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.owner.cpfCnpj} ·{" "}
                        {o.tipo === "proprietario_principal"
                          ? "Principal"
                          : o.tipo === "beneficiario"
                            ? "Beneficiário"
                            : "Proprietário"}
                      </div>
                    </div>
                    <Badge variant="outline">{o.percentual}%</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contratos vinculados</CardTitle>
          </CardHeader>
          <CardContent>
            {property.leaseContracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum contrato.</p>
            ) : (
              <ul className="divide-y">
                {property.leaseContracts.map((lc) => (
                  <li key={lc.id} className="py-2 text-sm">
                    <Link href={`/locacao/contratos/${lc.id}`} className="hover:underline">
                      {fmtBRL(lc.valorAluguel)} ·{" "}
                      {lc.tenants.map((t) => t.tenant.nome).join(", ") || "sem inquilinos"} ·{" "}
                      <Badge variant="outline">{lc.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seguros</CardTitle>
          </CardHeader>
          <CardContent>
            {property.insurancePolicies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem apólice cadastrada.</p>
            ) : (
              <ul className="divide-y">
                {property.insurancePolicies.map((ins) => (
                  <li key={ins.id} className="py-2 text-sm">
                    {ins.seguradora} — {ins.tipo} — vence{" "}
                    {ins.vigenciaFim.toLocaleDateString("pt-BR")}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <ExtratoImovelCard propertyId={property.id} orgId={org.id} />

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Despesas ({property.expenses.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {property.expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem despesas neste imóvel.</p>
            ) : (
              <ul className="divide-y">
                {property.expenses.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {e.type} {e.parcelaTotal > 1 ? `(${e.parcelaN}/${e.parcelaTotal})` : ""} —{" "}
                      {e.dueDate.toLocaleDateString("pt-BR")}
                    </span>
                    <span className="font-medium">{fmtBRL(e.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Manutenções ({property.maintenances.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {property.maintenances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem manutenção registrada.</p>
            ) : (
              <ul className="divide-y">
                {property.maintenances.map((m) => (
                  <li key={m.id} className="py-2 text-sm">
                    {m.tipo} · {m.descricao.slice(0, 80)} ·{" "}
                    <Badge variant="outline">{m.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );
}
