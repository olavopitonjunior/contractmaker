import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { OrgDetailClient } from "./OrgDetailClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenant — Admin" };

/** Detalhe de um tenant (deep-dive de métricas + ações). Gated por PlatformRole. */
export default async function AdminOrgDetailPage({
  params,
}: {
  params: { orgId: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, subdomain: true, suspendedAt: true },
  });
  if (!org) notFound();

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <Link href="/admin/orgs" className="text-xs text-muted-foreground hover:underline">
          ← Organizações
        </Link>
        <h1 className="font-display text-2xl font-semibold">
          {org.name}
          {org.suspendedAt && (
            <span className="ml-2 rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive align-middle">
              suspenso
            </span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {org.subdomain ?? "(sem subdomínio)"} · você é{" "}
          <span className="font-medium">{platformRole.role}</span>
        </p>
      </header>
      <OrgDetailClient
        orgId={org.id}
        orgName={org.name}
        subdomain={org.subdomain}
        initialSuspended={org.suspendedAt != null}
        canManage={platformRole.role === "super_admin"}
      />
    </div>
  );
}
