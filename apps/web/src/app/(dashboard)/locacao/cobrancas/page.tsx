import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pendente: "secondary",
  emitida: "outline",
  paga: "default",
  atrasada: "destructive",
  cancelada: "outline",
  repassada: "default",
};

export default async function LocacaoCobrancasPage({
  searchParams,
}: {
  searchParams?: Promise<{ competencia?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const params = (await searchParams) ?? {};
  const competencia =
    params.competencia && /^\d{4}-\d{2}$/.test(params.competencia)
      ? params.competencia
      : undefined;
  const status = params.status;

  const charges = await prisma.rentCharge.findMany({
    where: {
      orgId: org.id,
      ...(competencia ? { competencia } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      leaseContract: {
        include: {
          property: { select: { rua: true, numero: true } },
          tenants: { include: { tenant: { select: { nome: true } } } },
        },
      },
    },
    orderBy: { dueDate: "desc" },
    take: 500,
  });

  const total = charges.reduce((acc, c) => acc + c.valorBase + c.encargos + c.multa + c.juros, 0);
  const pagas = charges.filter((c) => c.status === "paga" || c.status === "repassada").length;
  const atrasadas = charges.filter((c) => c.status === "atrasada").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Cobranças de Aluguel</h2>
        <p className="text-sm text-muted-foreground">
          Lente sobre <code className="text-xs">/financeiro</code> filtrando{" "}
          <code className="text-xs">CommissionCharge.kind=&quot;aluguel&quot;</code> · {charges.length} cobranças ·{" "}
          {pagas} pagas · {atrasadas} atrasadas · total <strong>{fmtBRL(total)}</strong>
        </p>
      </div>

      {charges.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wallet className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhuma cobrança ainda. Cobranças são materializadas pelo cron{" "}
              <code className="text-xs">/api/cron/rent/generate</code> no dia 1 de cada mês.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {charges.map((c) => {
                const totalLinha = c.valorBase + c.encargos + c.multa + c.juros;
                const tenantName =
                  c.leaseContract?.tenants[0]?.tenant.nome ?? "—";
                const enderecoFmt = c.leaseContract?.property
                  ? `${c.leaseContract.property.rua ?? ""} ${c.leaseContract.property.numero ?? ""}`.trim()
                  : "—";
                return (
                  <li
                    key={c.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm hover:bg-muted/30"
                  >
                    <div className="col-span-2">
                      <div className="font-medium">{c.competencia}</div>
                      <div className="text-xs text-muted-foreground">
                        venc. {c.dueDate.toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    <div className="col-span-5">
                      <Link
                        href={`/locacao/contratos/${c.leaseContractId}`}
                        className="font-medium hover:underline"
                      >
                        {tenantName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{enderecoFmt}</div>
                    </div>
                    <div className="col-span-2">
                      <Badge variant="outline">{c.kind}</Badge>
                    </div>
                    <div className="col-span-2 text-right font-semibold">
                      {fmtBRL(totalLinha)}
                    </div>
                    <div className="col-span-1 text-right">
                      <Badge variant={STATUS_TONE[c.status] ?? "outline"}>{c.status}</Badge>
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
