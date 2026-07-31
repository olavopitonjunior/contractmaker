import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { AdminOrgsClient } from "./AdminOrgsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizações — Admin" };

/**
 * Painel super-admin de tenants (Fase 1e). Apex-only (/admin/orgs). Gated por
 * PlatformRole — quem não é staff de plataforma é mandado pra raiz.
 */
export default async function AdminOrgsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  const canCreate = platformRole.role === "super_admin";

  const rows = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      subdomain: true,
      createdAt: true,
      suspendedAt: true,
      _count: { select: { members: true, pipelines: true, asaasAccounts: true } },
    },
  });

  const orgs = rows.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    subdomain: o.subdomain,
    createdAt: o.createdAt.toISOString(),
    suspended: o.suspendedAt != null,
    members: o._count.members,
    pipelines: o._count.pipelines,
    asaasAccounts: o._count.asaasAccounts,
  }));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Organizações</h1>
        <p className="text-sm text-muted-foreground">
          Painel super-admin · {orgs.length} tenant(s) · você é{" "}
          <span className="font-medium">{platformRole.role}</span>
        </p>
        <nav className="mt-2 flex gap-4 text-sm">
          <a href="/admin/platform-roles" className="text-primary hover:underline">
            Papéis de plataforma
          </a>
          <a href="/admin/support-ai" className="text-primary hover:underline">
            IA de Suporte
          </a>
          <a href="/admin/agents" className="text-primary hover:underline">
            Agentes de IA
          </a>
        </nav>
      </header>
      <AdminOrgsClient orgs={orgs} canCreate={canCreate} />
    </div>
  );
}
