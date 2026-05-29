import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Wallet, FileText, Calendar } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * /portal/owner — portal do proprietário.
 *
 * Auth: usa o email da sessão pra encontrar PropertyOwner correspondente (qualquer org).
 * Idealmente PropertyOwner.userId 1:1, mas como o sistema multi-tenant complica,
 * Fase 1 usa email-match. Próximo passo: invite + auth elevation.
 */
export default async function OwnerPortalPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const email = session.user.email;
  if (!email) redirect("/login");

  // Encontra proprietários cadastrados com o mesmo email da sessão.
  const owners = await prisma.propertyOwner.findMany({
    where: { email },
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
              leaseContracts: {
                where: { status: "ativo" },
                include: {
                  rentCharges: {
                    where: { status: { in: ["paga", "repassada"] } },
                    orderBy: { paidAt: "desc" },
                    take: 12,
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (owners.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhum imóvel encontrado vinculado ao email <strong>{email}</strong>. Peça pra sua
            imobiliária cadastrar você como proprietário.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Soma repasses recebidos no ano atual.
  const currentYear = new Date().getFullYear();
  let totalRecebidoAno = 0;
  let proximoRepasse: { competencia: string; valor: number; data?: Date } | null = null;
  for (const owner of owners) {
    for (const own of owner.ownerships) {
      for (const lc of own.property.leaseContracts) {
        for (const rc of lc.rentCharges) {
          if (rc.paidAt && rc.paidAt.getFullYear() === currentYear) {
            const parteOwner =
              (rc.valorBase + rc.encargos) * (own.percentual / 100);
            totalRecebidoAno += parteOwner;
          }
        }
        // Próximo repasse: 1ª cobrança pendente do contrato.
        const proxima = lc.rentCharges.find((c) => c.status === "paga" && !c.paidAt);
        if (proxima && !proximoRepasse) {
          proximoRepasse = {
            competencia: proxima.competencia,
            valor: (proxima.valorBase + proxima.encargos) * (own.percentual / 100),
            data: proxima.dueDate,
          };
        }
      }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Olá, {owners[0].nome.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">
          Aqui você acompanha seus imóveis, repasses e documentos.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" /> Recebido em {currentYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmtBRL(totalRecebidoAno)}</div>
            <div className="text-xs text-muted-foreground">
              Soma dos repasses líquidos no ano corrente
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4" /> Próximo repasse
            </CardTitle>
          </CardHeader>
          <CardContent>
            {proximoRepasse ? (
              <>
                <div className="text-2xl font-semibold">{fmtBRL(proximoRepasse.valor)}</div>
                <div className="text-xs text-muted-foreground">
                  Competência {proximoRepasse.competencia}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Nada agendado.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {owners.map((owner) =>
        owner.ownerships.map((own) => (
          <Card key={own.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" />
                {own.property.rua} {own.property.numero}, {own.property.cidade}/{own.property.uf}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Sua participação: <strong>{own.percentual}%</strong> · Status:{" "}
                <Badge variant="outline">{own.property.status}</Badge>
              </p>
            </CardHeader>
            <CardContent>
              {own.property.leaseContracts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem contrato ativo.</p>
              ) : (
                <ul className="space-y-3">
                  {own.property.leaseContracts.map((lc) => (
                    <li key={lc.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">
                          Aluguel: {fmtBRL(lc.valorAluguel)}
                        </div>
                        <Badge variant="outline">{lc.status}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Últimos pagamentos: {lc.rentCharges.length} no histórico
                      </div>
                      {lc.rentCharges[0]?.paidAt && (
                        <div className="text-xs text-muted-foreground">
                          Última liquidação:{" "}
                          {lc.rentCharges[0].paidAt.toLocaleDateString("pt-BR")} —{" "}
                          {fmtBRL(
                            (lc.rentCharges[0].valorBase + lc.rentCharges[0].encargos) *
                              (own.percentual / 100)
                          )}{" "}
                          (sua parte)
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Informe de rendimentos (IR)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Disponível anualmente no fim do ano fiscal. Para gerar agora, fale com sua imobiliária.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
