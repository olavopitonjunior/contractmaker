import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { fetchMaxStatus } from "@/lib/max/admin-client";
import { FEATURE } from "@/lib/modules/catalog";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { MaxStatusPanel } from "./MaxStatusPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Max — Mission Control" };

/**
 * Mission Control do Max.
 *
 * O Newton tem painel próprio porque o OpenClaw traz um pronto. O Max não traz
 * — e um segundo painel, com login e deploy próprios, para três tenants seria
 * mais superfície pra manter e mais um lugar pra esquecer de olhar. Então ele
 * vive aqui, ao lado do console de agentes.
 *
 * A tela é de LEITURA: o que se configura do Max (modelo, instruções, teto,
 * kill switch de IA) já mora em /admin/agents, e o que roteia o canal são as
 * features por org. Aqui é o "está funcionando?".
 */
export default async function MaxMissionControlPage({
  searchParams,
}: {
  searchParams: { orgId?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Quais tenants estão ROTEADOS pro Max. É a pergunta que a tela responde
  // primeiro: sem nenhum, tudo aqui embaixo é ruído.
  const routed = await Promise.all(
    orgs.map(async (o) => {
      const view = await getOrgModules(o.id).catch(() => null);
      const vendas = view ? isFeatureEnabled(view, FEATURE.VENDAS_MAX) : false;
      const locacao = view ? isFeatureEnabled(view, FEATURE.LOCACAO_MAX) : false;
      return { ...o, vendas, locacao, on: vendas || locacao };
    })
  );

  const status = await fetchMaxStatus(searchParams.orgId);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">
          Max — Mission Control
        </h1>
        <p className="text-sm text-muted-foreground">
          Estado do agente de WhatsApp dos tenants RE/MAX: conexão da instância
          Z-API, fila de notificações e últimas entregas. Persona, modelo e teto
          ficam em{" "}
          <Link href="/admin/agents" className="underline">
            Agentes de IA
          </Link>
          ; quem recebe pelo Max é decidido pelas features{" "}
          <code>vendas.max</code>/<code>locacao.max</code> de cada org.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Tenants roteados pro Max</h2>
        {routed.some((r) => r.on) ? (
          <ul className="space-y-1 text-sm">
            {routed
              .filter((r) => r.on)
              .map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[r.vendas && "vendas", r.locacao && "locação"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum tenant roteado ainda — as features nascem desligadas. Ligue
            em <Link href="/admin/orgs" className="underline">Organizações</Link>{" "}
            quando o serviço estiver no ar.
          </p>
        )}
      </section>

      <MaxStatusPanel result={status} />
    </div>
  );
}
