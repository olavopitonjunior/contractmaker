import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail, Phone, CreditCard, MapPin, Building2 } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface Params {
  params: Promise<{ id: string }>;
}

export default async function ProprietarioDetailPage({ params }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");
  const { id } = await params;

  const owner = await prisma.propertyOwner.findFirst({
    where: { id, orgId: org.id },
    include: {
      ownerships: {
        include: {
          property: {
            select: {
              id: true,
              rua: true,
              numero: true,
              cidade: true,
              uf: true,
              status: true,
              valorAluguelSugerido: true,
            },
          },
        },
      },
    },
  });
  if (!owner) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/locacao/pessoas/proprietarios"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para proprietários
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{owner.nome}</h2>
          <p className="text-sm text-muted-foreground">
            {owner.tipoPessoa === "juridica" ? "Pessoa Jurídica" : "Pessoa Física"} ·{" "}
            {owner.cpfCnpj}
          </p>
        </div>
        <Badge variant="outline">Proprietário</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 py-4">
            <h3 className="text-base font-semibold">Contato</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {owner.email ?? "—"}
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {owner.phone ?? "—"}
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                Canal preferido: {owner.canalPreferido ?? "whatsapp"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 py-4">
            <h3 className="text-base font-semibold">Repasse</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                {owner.pixKey ? (
                  <span>
                    PIX ({owner.pixKeyType}): <code className="text-xs">{owner.pixKey}</code>
                  </span>
                ) : (
                  <span>Sem chave PIX cadastrada</span>
                )}
              </div>
              {owner.bankName && (
                <div className="text-xs text-muted-foreground">
                  {owner.bankName} · Ag {owner.bankBranch ?? "—"} · CC{" "}
                  {owner.bankAccount ?? "—"} · {owner.bankAccountType ?? "—"}
                </div>
              )}
              {owner.asaasWalletId && (
                <div className="text-xs">
                  Asaas wallet:{" "}
                  <code className="text-xs">{owner.asaasWalletId.slice(0, 16)}…</code>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Dia de repasse: {owner.repasseDia ?? "—"}
                {owner.antecipacaoHabilitada && " · antecipação habilitada"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardContent className="space-y-3 py-4">
            <h3 className="text-base font-semibold">
              Imóveis vinculados ({owner.ownerships.length})
            </h3>
            {owner.ownerships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum imóvel vinculado a este proprietário.
              </p>
            ) : (
              <ul className="divide-y">
                {owner.ownerships.map((o) => (
                  <li key={o.id} className="py-2 text-sm">
                    <Link
                      href={`/locacao/imoveis/${o.property.id}`}
                      className="flex items-center justify-between hover:underline"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {o.property.rua} {o.property.numero}
                          {o.property.cidade && ` · ${o.property.cidade}/${o.property.uf}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {o.tipo === "proprietario_principal"
                            ? "Principal"
                            : o.tipo === "beneficiario"
                              ? "Beneficiário"
                              : "Proprietário"}{" "}
                          ({o.percentual}%)
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline">{o.property.status}</Badge>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {fmtBRL(o.property.valorAluguelSugerido)}
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
