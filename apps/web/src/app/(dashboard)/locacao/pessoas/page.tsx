import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, ShieldUser, Briefcase, Wrench, HardHat } from "lucide-react";

export const dynamic = "force-dynamic";

interface Card {
  label: string;
  count: number;
  pjCount?: number;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

export default async function LocacaoPessoasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const [proprietariosTotal, proprietariosPj, locatariosTotal, locatariosPj, fiadoresTotal, corretoresTotal] =
    await Promise.all([
      prisma.propertyOwner.count({ where: { orgId: org.id } }),
      prisma.propertyOwner.count({ where: { orgId: org.id, tipoPessoa: "juridica" } }),
      prisma.tenant.count({ where: { orgId: org.id } }),
      prisma.tenant.count({ where: { orgId: org.id, tipoPessoa: "juridica" } }),
      prisma.guarantee.count({
        where: { orgId: org.id, tipo: "fiador", status: { in: ["pendente", "ativa"] } },
      }),
      prisma.leaseAngariador.count({ where: { orgId: org.id } }),
    ]);

  const cards: Card[] = [
    {
      label: "Proprietários",
      count: proprietariosTotal,
      pjCount: proprietariosPj,
      href: "/locacao/pessoas/proprietarios",
      icon: Users,
      description: "Donos dos imóveis cadastrados.",
    },
    {
      label: "Locatários",
      count: locatariosTotal,
      pjCount: locatariosPj,
      href: "/locacao/pessoas/locatarios",
      icon: UserCheck,
      description: "Inquilinos ativos e ex.",
    },
    {
      label: "Fiadores",
      count: fiadoresTotal,
      href: "/locacao/pessoas/fiadores",
      icon: ShieldUser,
      description: "Pessoas que garantem contratos via fiança.",
    },
    {
      label: "Corretores / Angariadores",
      count: corretoresTotal,
      href: "/locacao/pessoas/corretores",
      icon: Briefcase,
      description: "Captadores que recebem comissão recorrente.",
    },
    {
      label: "Fornecedores",
      count: 0,
      href: "/locacao/pessoas/fornecedores",
      icon: Wrench,
      description: "Empresas de manutenção, seguros e serviços.",
    },
    {
      label: "Vistoriadores",
      count: 0,
      href: "/locacao/pessoas/vistoriadores",
      icon: HardHat,
      description: "Quem executa as vistorias de entrada/saída.",
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Pessoas</h2>
        <p className="text-sm text-muted-foreground">
          Dashboard unificado de stakeholders. Espelha o módulo Pessoas do Superlógica §6.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.label} href={c.href} className="group block focus:outline-none">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {c.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 pt-0">
                  <div className="text-2xl font-semibold">{c.count}</div>
                  {c.pjCount != null && c.pjCount > 0 && (
                    <div className="text-xs text-muted-foreground">{c.pjCount} jurídicas</div>
                  )}
                  <div className="text-xs text-muted-foreground">{c.description}</div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
