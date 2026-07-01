import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { FiscalSettingsForm } from "@/components/settings/FiscalSettingsForm";

export const dynamic = "force-dynamic";

/**
 * /settings/fiscal — dados fiscais do declarante usados na DIMOB (registro R01).
 * Edita colunas de Organization (legalName/cnpj/legalAddress/creci) + os campos
 * fiscais dedicados (responsável, UF, município).
 */
export default async function FiscalSettingsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  const data = await prisma.organization.findUnique({
    where: { id: org.id },
    select: {
      legalName: true,
      cnpj: true,
      creci: true,
      legalAddress: true,
      fiscalResponsibleCpf: true,
      fiscalUf: true,
      fiscalMunicipioCode: true,
      fiscalMunicipioName: true,
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dados fiscais (declarante)"
        description="Identificação da imobiliária usada na DIMOB (registro R01). Preencha antes de gerar o arquivo."
      />
      <FiscalSettingsForm initial={data ?? {}} />
    </div>
  );
}
