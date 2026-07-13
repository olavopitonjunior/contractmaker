import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Wallet, FileText, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * /portal/tenant — portal do inquilino.
 * Auth via email-match com Tenant.
 */
export default async function TenantPortalPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const email = session.user.email;
  if (!email) redirect("/login");

  const tenants = await prisma.tenant.findMany({
    where: { email },
    include: {
      leaseTenants: {
        include: {
          leaseContract: {
            include: {
              property: {
                select: { rua: true, numero: true, cidade: true, uf: true },
              },
              rentCharges: { orderBy: { dueDate: "desc" }, take: 12 },
            },
          },
        },
      },
    },
  });

  if (tenants.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhum contrato encontrado vinculado ao email <strong>{email}</strong>. Peça pra sua
            imobiliária cadastrar você como locatário.
          </p>
        </CardContent>
      </Card>
    );
  }

  const allLeases = tenants.flatMap((t) => t.leaseTenants.map((lt) => lt.leaseContract));
  const allCharges = allLeases.flatMap((lc) => lc.rentCharges);
  const pendentes = allCharges.filter((c) => c.status === "pendente" || c.status === "emitida");
  const atrasadas = allCharges.filter((c) => c.status === "atrasada");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Olá, {tenants[0].nome.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">
          Suas cobranças, contrato e chamados em um só lugar.
        </p>
      </div>

      {atrasadas.length > 0 && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <div className="font-medium text-destructive">
                {atrasadas.length} cobrança(s) em atraso
              </div>
              <div className="text-xs text-muted-foreground">
                Quite o quanto antes pra evitar multas adicionais.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> Cobranças
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendentes.length === 0 && atrasadas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma cobrança pendente.</p>
          ) : (
            <ul className="space-y-2">
              {[...atrasadas, ...pendentes].map((c) => {
                const total = c.valorBase + c.encargos + c.multa + c.juros;
                return (
                  <li
                    key={c.id}
                    className={`flex items-center justify-between rounded-md border p-3 text-sm ${
                      c.status === "atrasada" ? "border-destructive/50 bg-destructive/5" : ""
                    }`}
                  >
                    <div>
                      <div className="font-medium">
                        {c.competencia} · venc. {c.dueDate.toLocaleDateString("pt-BR")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Aluguel {fmtBRL(c.valorBase)} + encargos {fmtBRL(c.encargos)}
                        {c.multa > 0 && ` + multa ${fmtBRL(c.multa)}`}
                        {c.juros > 0 && ` + juros ${fmtBRL(c.juros)}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{fmtBRL(total)}</div>
                      <Badge variant={c.status === "atrasada" ? "destructive" : "secondary"}>
                        {c.status}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {allLeases.map((lc) => (
        <Card key={lc.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              {lc.property?.rua} {lc.property?.numero}, {lc.property?.cidade}/{lc.property?.uf}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Aluguel {fmtBRL(lc.valorAluguel)} · vencimento dia {lc.diaVencimento} · vigência até{" "}
              {lc.vigenciaFim?.toLocaleDateString("pt-BR") ?? "indeterminado"}
            </p>
          </CardHeader>
          <CardContent>
            <Link
              href={`/portal/tenant/contratos/${lc.id}`}
              className="text-sm text-primary hover:underline"
            >
              <FileText className="mr-1 inline h-3.5 w-3.5" />
              Ver contrato completo →
            </Link>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chamados de manutenção</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Pra solicitar reparo, fale com sua imobiliária pelo WhatsApp.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
