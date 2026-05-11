import { prisma } from "@/lib/db/prisma";
import { generatePublicToken } from "@/lib/security/crypto";

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
    include: {
      org: { select: { name: true } },
    },
  });
  if (!charge) throw new Error("Charge not found");

  // Branding agora é per-conta (financialSettings.accountId @unique). Resolve
  // via charge.accountId; fallback pra primeira conta da org.
  let brand: { brandDisplayName: string | null; brandLogoUrl: string | null; brandPrimaryColor: string | null; brandSupportEmail: string | null; brandSupportPhone: string | null } | null = null;
  if (charge.accountId) {
    brand = await prisma.orgFinancialSettings.findUnique({
      where: { accountId: charge.accountId },
      select: {
        brandDisplayName: true,
        brandLogoUrl: true,
        brandPrimaryColor: true,
        brandSupportEmail: true,
        brandSupportPhone: true,
      },
    });
  }
  if (!brand) {
    brand = await prisma.orgFinancialSettings.findFirst({
      where: { orgId: charge.orgId },
      select: {
        brandDisplayName: true,
        brandLogoUrl: true,
        brandPrimaryColor: true,
        brandSupportEmail: true,
        brandSupportPhone: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }
  const snapshot = {
    displayName: brand?.brandDisplayName ?? charge.org.name,
    logoUrl: brand?.brandLogoUrl ?? null,
    primaryColor: brand?.brandPrimaryColor ?? "#0f172a",
    supportEmail: brand?.brandSupportEmail ?? null,
    supportPhone: brand?.brandSupportPhone ?? null,
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
