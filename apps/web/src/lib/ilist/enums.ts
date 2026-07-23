// UIDs da RexAPI validados empiricamente na região 71 (QA Gryphtech) em
// 2026-07-23 — dump completo em docs/integracoes/ilist-rexapi-study.md §4.
// Client-safe (sem segredos): pode ser importado por componentes.

export const TRANSACTION_TYPE = {
  RENT: 260, // For Rent/Lease
  SALE: 261, // For Sale
} as const;

export const LISTING_STATUS = {
  ACTIVE: 160,
  CANCELLED: 161,
  EXPIRED: 162,
  ON_OPTION: 164,
  PARTIALLY_RENTED: 165,
  PROSPECTIVE: 166,
  RENTED: 167,
  SALE_AGREED: 168,
  SOLD: 169,
  SOLD_BY_OTHER_AGENT: 170,
  SOLD_BY_OWNER: 171,
  PROPOSAL: 1616,
  DRAFT: 4812,
} as const;

export const LISTING_STATUS_LABELS: Record<number, string> = {
  [LISTING_STATUS.ACTIVE]: "Ativo",
  [LISTING_STATUS.CANCELLED]: "Cancelado",
  [LISTING_STATUS.EXPIRED]: "Expirado",
  [LISTING_STATUS.ON_OPTION]: "Em opção",
  [LISTING_STATUS.PARTIALLY_RENTED]: "Parcialmente alugado",
  [LISTING_STATUS.PROSPECTIVE]: "Prospecção",
  [LISTING_STATUS.RENTED]: "Alugado",
  [LISTING_STATUS.SALE_AGREED]: "Venda acordada",
  [LISTING_STATUS.SOLD]: "Vendido",
  [LISTING_STATUS.SOLD_BY_OTHER_AGENT]: "Vendido por outro corretor",
  [LISTING_STATUS.SOLD_BY_OWNER]: "Vendido pelo proprietário",
  [LISTING_STATUS.PROPOSAL]: "Em proposta",
  [LISTING_STATUS.DRAFT]: "Rascunho",
};

export function listingStatusLabel(uid: number): string {
  return LISTING_STATUS_LABELS[uid] ?? `Status ${uid}`;
}

/** DescriptionType usados no import (Property_DescriptionType). */
export const DESCRIPTION_TYPE_WEB = 629;
export const DESCRIPTION_TYPE_LISTING_TITLE = 1113;

/** Código de idioma PT-BR na RexAPI. */
export const LANG_PTB = "PTB";

/** URL pública de uma imagem de listing (validada: {base}/userimages/{RegionID}/{img}). */
export function ilistImageUrl(baseUrl: string, regionId: number, imageName: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/userimages/${regionId}/${imageName}`;
}
