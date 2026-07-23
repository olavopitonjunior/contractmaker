import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { isIListEnvConfigured } from "@/lib/ilist/env";
import { OrgIListClient } from "./OrgIListClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integração iList — Admin" };

/**
 * Provisioning da conexão iList/RexAPI de um tenant RE/MAX (região + offices).
 * Exclusivo super_admin — a credencial da RexAPI é global e o token acessa
 * todas as regiões; este vínculo é o que delimita o que o tenant enxerga.
 */
export default async function OrgIListPage({ params }: { params: { orgId: string } }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (platformRole?.role !== "super_admin") redirect("/admin/orgs");

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, subdomain: true },
  });
  if (!org) notFound();

  const connection = await prisma.iListConnection.findUnique({ where: { orgId: org.id } });
  const counts = connection
    ? {
        total: await prisma.iListListing.count({
          where: { connectionId: connection.id, deletedAt: null },
        }),
        ativos: await prisma.iListListing.count({
          where: { connectionId: connection.id, deletedAt: null, listingStatus: 160 },
        }),
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <Link href="/admin/orgs" className="text-sm text-muted-foreground hover:underline">
          ← Organizações
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-muted-foreground">
          Integração iList (RE/MAX) {org.subdomain ? `· ${org.subdomain}` : ""}
        </p>
      </header>

      {!isIListEnvConfigured() ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Credenciais globais da RexAPI ausentes no ambiente (ILIST_BASE_URL, ILIST_API_KEY,
          ILIST_SECRET_KEY). Configure no Vercel antes de provisionar tenants.
        </div>
      ) : (
        <OrgIListClient
          orgId={org.id}
          initialConnection={
            connection
              ? {
                  regionId: connection.regionId,
                  officeIds: connection.officeIds,
                  enabled: connection.enabled,
                  syncStatus: connection.syncStatus,
                  lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
                  lastSyncError: connection.lastSyncError,
                  lastFullSyncAt: connection.lastFullSyncAt?.toISOString() ?? null,
                }
              : null
          }
          initialCounts={counts}
        />
      )}
    </div>
  );
}
