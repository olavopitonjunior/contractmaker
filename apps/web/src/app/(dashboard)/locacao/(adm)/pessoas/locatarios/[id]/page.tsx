import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail, Phone, FileText, Building2 } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface Params {
  params: Promise<{ id: string }>;
}

export default async function LocatarioDetailPage({ params }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");
  const { id } = await params;

  const tenant = await prisma.tenant.findFirst({
    where: { id, orgId: org.id },
    include: {
      leaseTenants: {
        include: {
          leaseContract: {
            include: {
              property: {
                select: { rua: true, numero: true, cidade: true, uf: true },
              },
            },
          },
        },
      },
      creditAnalyses: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
  if (!tenant) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/locacao/pessoas/locatarios"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para locatários
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{tenant.nome}</h2>
          <p className="text-sm text-muted-foreground">
            {tenant.tipoPessoa === "juridica" ? "Pessoa Jurídica" : "Pessoa Física"} ·{" "}
            {tenant.cpfCnpj}
          </p>
        </div>
        <Badge variant="outline">Locatário</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 py-4">
            <h3 className="text-base font-semibold">Contato</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {tenant.email ?? "—"}
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {tenant.phone ?? "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 py-4">
            <h3 className="text-base font-semibold">Análises de crédito</h3>
            {tenant.creditAnalyses.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem análise registrada.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {tenant.creditAnalyses.map((ca) => (
                  <li key={ca.id} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {ca.createdAt.toLocaleDateString("pt-BR")} · score{" "}
                      {ca.scoreBureau ?? ca.scoreInterno ?? "—"}
                    </span>
                    <Badge
                      variant={
                        ca.status === "aprovado" || ca.status === "aprovado_com_garantia"
                          ? "default"
                          : ca.status === "recusado"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {ca.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardContent className="space-y-3 py-4">
            <h3 className="text-base font-semibold">
              Contratos vinculados ({tenant.leaseTenants.length})
            </h3>
            {tenant.leaseTenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem contratos vinculados.</p>
            ) : (
              <ul className="divide-y">
                {tenant.leaseTenants.map((lt) => (
                  <li key={lt.id} className="py-2 text-sm">
                    <Link
                      href={`/locacao/contratos/${lt.leaseContract.id}`}
                      className="flex items-center justify-between hover:underline"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {lt.leaseContract.property?.rua} {lt.leaseContract.property?.numero}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <Badge variant="outline" className="mr-1">
                            {lt.tipo}
                          </Badge>
                          status {lt.leaseContract.status}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">
                          {fmtBRL(lt.leaseContract.valorAluguel)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <FileText className="mr-1 inline h-3 w-3" />
                          ver contrato
                        </div>
                      </div>
                    </Link>
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
