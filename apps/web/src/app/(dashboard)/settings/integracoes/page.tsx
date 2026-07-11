import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { GoogleDriveCard } from "@/components/settings/GoogleDriveCard";

export default async function IntegracoesPage({
  searchParams,
}: {
  searchParams: { google_error?: string };
}) {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  const account = await prisma.orgGoogleAccount.findUnique({
    where: { orgId: org.id },
    select: { email: true, status: true, lastUsedAt: true, lastErrorMessage: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrações"
        description="Conexões externas da imobiliária."
      />
      <GoogleDriveCard
        initial={{
          connected: account?.status === "connected",
          status: account?.status ?? "disconnected",
          email: account?.email ?? null,
          lastErrorMessage: account?.lastErrorMessage ?? null,
        }}
        connectError={searchParams.google_error ?? null}
      />
    </div>
  );
}
