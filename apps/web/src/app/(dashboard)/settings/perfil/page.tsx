import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AgencyProfileForm } from "@/components/onboarding/AgencyProfileForm";

export const dynamic = "force-dynamic";

export default async function PerfilImobiliariaPage() {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  const data = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { legalName: true, cnpj: true, creci: true, legalAddress: true },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Perfil da imobiliária"
        description="Razão social, CNPJ, CRECI e endereço — é o que nomeia a administradora nas cláusulas dos contratos de locação."
      />
      <Card>
        <CardContent className="pt-6">
          <AgencyProfileForm
            initial={{
              legalName: data?.legalName,
              cnpj: data?.cnpj,
              creci: data?.creci,
              legalAddress: data?.legalAddress,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
