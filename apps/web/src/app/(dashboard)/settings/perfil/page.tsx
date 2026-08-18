import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgencyProfileForm } from "@/components/onboarding/AgencyProfileForm";
import { BrandingForm } from "@/components/settings/BrandingForm";
import { getOrgBrand } from "@/lib/tenant/branding";

export const dynamic = "force-dynamic";

export default async function PerfilImobiliariaPage() {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  const [data, brand] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: org.id },
      select: { legalName: true, cnpj: true, creci: true, legalAddress: true },
    }),
    // Já resolvido (nome e contato derivados da org quando ninguém preencheu) —
    // o dono não encontra a tela em branco.
    getOrgBrand(org.id),
  ]);

  // pb-24: o FAB do assistente (fixed bottom-6 right-6) cobria o "Salvar
  // identidade" no fim da página em viewport estreita.
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <PageHeader
        title="Perfil da imobiliária"
        description="Os dados que identificam a sua imobiliária nos contratos e diante dos seus clientes."
      />

      <Card>
        <CardHeader>
          <CardTitle>Dados cadastrais</CardTitle>
        </CardHeader>
        <CardContent>
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

      <Card>
        <CardHeader>
          <CardTitle>Identidade visual</CardTitle>
        </CardHeader>
        <CardContent>
          <BrandingForm
            initial={{
              displayName: brand.displayName,
              supportEmail: brand.supportEmail,
              supportPhone: brand.supportPhone,
              logoUrl: brand.logoUrl,
              primaryColor: brand.primaryColor,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
