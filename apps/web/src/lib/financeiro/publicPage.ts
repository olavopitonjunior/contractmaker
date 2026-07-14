import { prisma } from "@/lib/db/prisma";
import { generatePublicToken } from "@/lib/security/crypto";
import { getOrgBrand } from "@/lib/tenant/branding";

/**
 * Cria (ou retorna existente) ChargePublicLink para uma charge.
 * brandSnapshot é congelado na criação para garantir que mudanças de branding
 * futuras não afetem links já compartilhados.
 */
export async function mintPublicLink(chargeId: string): Promise<string> {
  const existing = await prisma.chargePublicLink.findUnique({
    where: { chargeId },
  });
  if (existing) return existing.publicToken;

  const charge = await prisma.commissionCharge.findUnique({
    where: { id: chargeId },
    select: { id: true, orgId: true },
  });
  if (!charge) throw new Error("Charge not found");

  // A marca é da IMOBILIÁRIA, não da conta de recebimento. Antes o branding vinha
  // de OrgFinancialSettings (1:1 com a conta Asaas): uma org com duas contas tinha
  // duas marcas, e uma org sem conta caía no nome cru da org, sem logo nem cor.
  // getOrgBrand resolve a fonte canônica e deriva os defaults.
  const brand = await getOrgBrand(charge.orgId);
  const snapshot = {
    displayName: brand.displayName,
    logoUrl: brand.logoUrl,
    primaryColor: brand.primaryColor,
    supportEmail: brand.supportEmail,
    supportPhone: brand.supportPhone,
    capturedAt: new Date().toISOString(),
  };

  // Gera token único — retry se colidir (improvável)
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generatePublicToken(12);
    try {
      const created = await prisma.chargePublicLink.create({
        data: {
          chargeId,
          publicToken: token,
          brandSnapshot: snapshot as any,
        },
      });
      return created.publicToken;
    } catch (err: any) {
      if (err?.code === "P2002") continue; // unique violation
      throw err;
    }
  }
  throw new Error("Não foi possível gerar token único");
}

export async function resolvePublicToken(token: string) {
  const link = await prisma.chargePublicLink.findUnique({
    where: { publicToken: token },
    include: {
      charge: {
        include: {
          customer: true,
        },
      },
    },
  });
  return link;
}
