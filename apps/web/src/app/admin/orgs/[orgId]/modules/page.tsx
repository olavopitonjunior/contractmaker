import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { getOrgModules } from "@/lib/modules/read";
import { MODULE_CATALOG } from "@/lib/modules/catalog";
import { OrgModulesClient } from "./OrgModulesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Módulos da organização — Admin" };

/**
 * Gestão de módulos/sub-funções de um tenant. Leitura support+, escrita super_admin.
 */
export default async function OrgModulesPage({
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
    select: { id: true, name: true, subdomain: true },
  });
  if (!org) notFound();

  const current = await getOrgModules(org.id);
  const canEdit = platformRole.role === "super_admin";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <Link
          href="/admin/orgs"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Organizações
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-muted-foreground">
          Módulos e sub-funções {org.subdomain ? `· ${org.subdomain}` : ""}
          {!canEdit && " · somente leitura (requer super_admin)"}
        </p>
      </header>

      <OrgModulesClient
        orgId={org.id}
        catalog={MODULE_CATALOG}
        initial={current}
        canEdit={canEdit}
      />
    </div>
  );
}
