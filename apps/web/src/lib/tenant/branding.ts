import { prisma } from "@/lib/db/prisma";

/**
 * White-label per-tenant (Fase 1a). Carrega o BrandingSettings da org e converte
 * as cores hex pros triplets HSL que os tokens do design system consomem
 * (`--primary: H S% L%` → usado como `hsl(var(--primary))`). O render injeta os
 * vars inline num wrapper `[data-tenant]` (ver globals.css + dashboard layout).
 */

export interface TenantBranding {
  logoUrl: string | null;
  /** HSL triplet "H S% L%" pronto pra `--primary`, ou null se sem custom. */
  primaryHsl: string | null;
  /** HSL triplet pra `--brand-accent`, ou null. */
  accentHsl: string | null;
  poweredBy: boolean;
}

/** Converte hex (#RRGGBB ou #RGB) pro triplet "H S% L%". null se inválido. */
export function hexToHslTriplet(hex: string | null | undefined): string | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;

  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      default:
        hue = (r - g) / d + 4;
    }
    hue /= 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%`;
}

export async function getTenantBranding(
  orgId: string
): Promise<TenantBranding | null> {
  const b = await prisma.brandingSettings.findUnique({ where: { orgId } });
  if (!b) return null;
  return {
    logoUrl: b.logoUrl ?? null,
    primaryHsl: hexToHslTriplet(b.primaryColor),
    accentHsl: hexToHslTriplet(b.secondaryColor),
    poweredBy: b.poweredBy,
  };
}

/** Cor da casa quando o tenant não escolheu uma. */
export const DEFAULT_BRAND_COLOR = "#0f172a";

/**
 * A marca da imobiliária como o cliente final a vê — nome, logo, cor e contato.
 * FONTE ÚNICA: BrandingSettings (1:1 com a org). Antes disso, o branding vivia
 * em OrgFinancialSettings, que é 1:1 com a CONTA ASAAS — uma org com duas contas
 * tinha duas marcas, e uma org sem conta (o caso dos tenants novos) não tinha
 * nenhuma.
 *
 * Os defaults são DERIVADOS de dados que já existem, não exigidos do dono: uma
 * imobiliária recém-cadastrada nunca aparece sem nome nem sem contato, mesmo que
 * ninguém tenha aberto a tela de identidade visual.
 */
export interface OrgBrand {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  supportEmail: string | null;
  supportPhone: string | null;
  poweredBy: boolean;
}

export async function getOrgBrand(orgId: string): Promise<OrgBrand> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      name: true,
      legalName: true,
      brandingSettings: true,
      members: {
        where: { role: "owner" },
        orderBy: { invitedAt: "asc" },
        take: 1,
        select: { user: { select: { email: true } } },
      },
    },
  });

  const b = org?.brandingSettings ?? null;
  const ownerEmail = org?.members[0]?.user.email ?? null;

  return {
    // Nome FANTASIA na frente da razão social: este nome assina e-mails e a
    // página de pagamento, onde o cliente espera "RE/MAX Ativa", não "Ativa
    // Consultoria Imobiliaria Ltda". A razão social é o nome de contrato — mora
    // em Organization.legalName e é usada lá.
    displayName:
      b?.displayName?.trim() ||
      org?.name?.trim() ||
      org?.legalName?.trim() ||
      "Imobiliária",
    logoUrl: b?.logoUrl?.trim() || null,
    primaryColor: b?.primaryColor?.trim() || DEFAULT_BRAND_COLOR,
    supportEmail: b?.supportEmail?.trim() || ownerEmail,
    supportPhone: b?.supportPhone?.trim() || null,
    poweredBy: b?.poweredBy ?? true,
  };
}
