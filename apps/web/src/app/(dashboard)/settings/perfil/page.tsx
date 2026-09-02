import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { getEffectivePermissions } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { RECEBIMENTO_SELECT } from "@/lib/forms/commissioner-receiving";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgencyProfileForm } from "@/components/onboarding/AgencyProfileForm";
import { AgencyReceivingForm } from "@/components/settings/AgencyReceivingForm";
import { BrandingForm } from "@/components/settings/BrandingForm";
import { getOrgBrand } from "@/lib/tenant/branding";

export const dynamic = "force-dynamic";

export default async function PerfilImobiliariaPage() {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  // A conta de recebimento é dado bancário: o card só aparece para quem pode
  // EDITAR as configurações da org (dono/admin) — o formulário não serve para
  // mais ninguém, e `ORG_SETTINGS_READ` (que abre esta página) chega a
  // vendedor e visualizador. Id efetivo respeita impersonation, como a rota.
  const effUserId = await getEffectiveUserId(session.user.id);
  const [data, brand, eff, recebimento] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: org.id },
      select: { legalName: true, cnpj: true, creci: true, legalAddress: true },
    }),
    // Já resolvido (nome e contato derivados da org quando ninguém preencheu) —
    // o dono não encontra a tela em branco.
    getOrgBrand(org.id),
    getEffectivePermissions(effUserId, org.id),
    // Consulta à parte e tolerante: num deploy sem a migration (preview de PR,
    // que não migra), as colunas não existem — a página degrada para o card
    // vazio em vez de derrubar razão social e identidade visual junto.
    prisma.organization
      .findUnique({ where: { id: org.id }, select: RECEBIMENTO_SELECT })
      .catch((err: unknown) => {
        console.warn("[perfil] recebimento da imobiliária indisponível:", err);
        return null;
      }),
  ]);
  const podeEditar = eff?.permissions[PERMISSION.ORG_SETTINGS_EDIT] === true;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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

      {/* Dado fixo da imobiliária (não padrão por formulário): a conta onde ela
          recebe a comissão de intermediação, impressa pela chave
          {{imobiliaria_dados_pagamento}} nos modelos de locação. */}
      {podeEditar && (
        <Card id="recebimento-comissao" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Onde a imobiliária recebe a comissão</CardTitle>
          </CardHeader>
          <CardContent>
            <AgencyReceivingForm
              initial={{
                pixAddressKey: recebimento?.pixAddressKey,
                pixKeyType: recebimento?.pixKeyType,
                bankName: recebimento?.bankName,
                bankBranch: recebimento?.bankBranch,
                bankAccount: recebimento?.bankAccount,
                bankAccountType: recebimento?.bankAccountType,
                bankHolderName: recebimento?.bankHolderName,
                bankHolderDoc: recebimento?.bankHolderDoc,
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* `id` é o alvo do passo `branding` do onboarding (`stepUrl`) — sem ele
          o CTA cairia no topo da página, longe do bloco do logo. */}
      <Card id="identidade-visual" className="scroll-mt-20">
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
