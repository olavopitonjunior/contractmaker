// Payload de import de um listing: extras lazy (descrição Web/PTB + fotos —
// 2 calls só no momento do import, nunca no sync) + os 3 shapes de destino.

import { prisma } from "@/lib/db/prisma";
import type { IListListing } from "@prisma/client";
import { createIListClient } from "./client";
import { getIListEnv } from "./env";
import {
  DESCRIPTION_TYPE_WEB,
  LANG_PTB,
  ilistImageUrl,
  listingStatusLabel,
} from "./enums";
import {
  toComissaoSeed,
  toLocacaoPropertyFields,
  toProposalSnapshot,
  toVendasImovel,
  type IListImportExtras,
} from "./mapping";

export interface IListImportPayload {
  ilistId: string;
  listingCode: string | null;
  transactionType: number;
  listingStatus: number;
  statusLabel: string;
  locacaoFields: Record<string, unknown>;
  vendasImovel: Record<string, string>;
  proposalSnapshot: ReturnType<typeof toProposalSnapshot>;
  comissao: ReturnType<typeof toComissaoSeed>;
  fotos: string[];
}

async function fetchExtras(
  regionId: number,
  listing: IListListing,
): Promise<IListImportExtras & { coverImageUrl?: string }> {
  const client = createIListClient(regionId);
  const env = getIListEnv();
  const extras: IListImportExtras & { coverImageUrl?: string } = {};

  // Descrição Web em PT-BR (fallback: qualquer Web).
  try {
    const res = await client.propertyDescriptions.list(listing.ilistId);
    const webs = res.Items.filter((d) => d.DescriptionType === DESCRIPTION_TYPE_WEB);
    const ptb = webs.find((d) => d.LanguageCode?.toUpperCase() === LANG_PTB) ?? webs[0];
    if (ptb?.DescriptionText) {
      // A API devolve HTML entities/rich text simples — strip básico de tags.
      extras.descricao = ptb.DescriptionText.replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  } catch {
    // Best-effort: sem descrição o mapping usa o fallback gerado.
  }

  try {
    const images = await client.propertyImages.list(listing.ilistId);
    const sorted = [...(Array.isArray(images) ? images : [])].sort(
      (a, b) => (a.SequenceNumber ?? 999) - (b.SequenceNumber ?? 999),
    );
    const urls = sorted
      .filter((i) => i.ImageURL)
      .map((i) => ilistImageUrl(env.baseUrl, regionId, i.ImageURL as string));
    if (urls.length) {
      extras.fotos = urls.slice(0, 20);
      const def = sorted.find((i) => i.IsDefault && i.ImageURL);
      extras.coverImageUrl = def
        ? ilistImageUrl(env.baseUrl, regionId, def.ImageURL as string)
        : urls[0];
    }
  } catch {
    // Best-effort: sem fotos.
  }

  return extras;
}

/**
 * Monta o payload de import de uma row DO ESPELHO (já org-scoped pelo caller).
 * Persiste `coverImageUrl` de volta como cache do card.
 */
export async function buildImportPayload(
  listing: IListListing,
  regionId: number,
): Promise<IListImportPayload> {
  const extras = await fetchExtras(regionId, listing);

  if (extras.coverImageUrl && extras.coverImageUrl !== listing.coverImageUrl) {
    await prisma.iListListing
      .update({ where: { id: listing.id }, data: { coverImageUrl: extras.coverImageUrl } })
      .catch(() => {});
  }

  return {
    ilistId: listing.ilistId,
    listingCode: listing.listingCode,
    transactionType: listing.transactionType,
    listingStatus: listing.listingStatus,
    statusLabel: listingStatusLabel(listing.listingStatus),
    locacaoFields: toLocacaoPropertyFields(listing, extras),
    vendasImovel: toVendasImovel(listing, extras),
    proposalSnapshot: toProposalSnapshot(listing),
    comissao: toComissaoSeed(listing),
    fotos: extras.fotos ?? [],
  };
}
