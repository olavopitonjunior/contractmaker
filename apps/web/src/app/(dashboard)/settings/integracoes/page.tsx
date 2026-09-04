import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { GoogleDriveCard } from "@/components/settings/GoogleDriveCard";
import { FichaCertaAccountCard } from "@/components/settings/FichaCertaAccountCard";
import { formatDateTimeBR } from "@/lib/format/datetime";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import {
  FICHACERTA_STAGE_BASE_URL,
  parseProducts,
  tokenUrlForSlug,
  webhookUrlForSlug,
} from "@/lib/fichacerta/account";

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
  // Ficha Certa (análise de crédito na proposta de locação) — conta por org.
  // O card é só de owner/admin (mesmo gate das rotas /api/settings/fichacerta):
  // login, ambiente e URLs do webhook não vão para o HTML de um `member`.
  // Só metadados chegam ao client; senha e segredos do webhook ficam no banco.
  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  const isOrgAdmin = !!membership && ["owner", "admin"].includes(membership.role);
  const fc = isOrgAdmin
    ? await prisma.fichaCertaAccount.findUnique({ where: { orgId: org.id } })
    : null;

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
      {isOrgAdmin && (
      <FichaCertaAccountCard
        initial={{
          connected: fc?.status === "connected",
          status: fc?.status ?? "disconnected",
          label: fc?.label ?? null,
          login: fc?.login ?? null,
          environment: fc
            ? fc.baseUrl.startsWith(FICHACERTA_STAGE_BASE_URL)
              ? "homologacao"
              : "producao"
            : null,
          products: fc ? parseProducts(fc.products) : null,
          costCents: fc?.costCents ?? null,
          webhookUrl: fc ? webhookUrlForSlug(fc.webhookSlug) : null,
          tokenUrl: fc ? tokenUrlForSlug(fc.webhookSlug) : null,
          webhookProvisioned: fc?.webhookProvisioned ?? false,
          lastValidatedAtLabel: fc?.lastValidatedAt ? formatDateTimeBR(fc.lastValidatedAt) : null,
          lastError: fc?.lastError ?? null,
        }}
      />
      )}
    </div>
  );
}
