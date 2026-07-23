// Mapeamento IListListing (espelho) → shapes de destino do Contractmaker:
//  1. propertyCreateSchema (locação, camelCase)
//  2. item de SalesForm.dataJson.imoveis[] (vendas, snake_case, descricao min 10)
//  3. snapshot de proposta (dataJson.imoveis[0])
// Client-safe? NÃO — usa tipos do Prisma; importar só em server code.

import type { IListListing } from "@prisma/client";
import { TRANSACTION_TYPE } from "./enums";

/** Extras buscados lazy no import (descrição Web/PTB + fotos). */
export interface IListImportExtras {
  descricao?: string;
  fotos?: string[];
}

// PropertyType UID → Property.kind. Mapa parcial (preenchido empiricamente na
// região 71 — 202 é o tipo residencial genérico observado); UID fora do mapa
// cai em "outro" (nunca bloquear o import por tipo desconhecido).
const PROPERTY_TYPE_TO_KIND: Record<number, string> = {
  194: "apartamento", // Condo/Apartment
  202: "casa",
  191: "casa", // Bungalow
  195: "casa", // Cottage
};

export function kindForPropertyType(uid: number | null | undefined): string {
  if (!uid) return "outro";
  return PROPERTY_TYPE_TO_KIND[uid] ?? "outro";
}

export function formatEndereco(l: IListListing): string {
  const rua = [l.streetName, l.streetNumber].filter(Boolean).join(", ");
  const cidadeUf = [l.city, l.uf].filter(Boolean).join("/");
  return [rua, cidadeUf].filter(Boolean).join(" — ") || `Imóvel iList ${l.listingCode ?? l.ilistId}`;
}

function priceNumber(l: IListListing): number | undefined {
  if (l.price === null || l.price === undefined) return undefined;
  const n = Number(l.price);
  return Number.isNaN(n) ? undefined : n;
}

/** true quando é seguro semear valores monetários (só BRL). */
export function isBrlPrice(l: IListListing): boolean {
  return !l.currency || l.currency.toUpperCase() === "BRL";
}

// ---------------------------------------------------------------------------
// 1. Locação — shape do propertyCreateSchema
// ---------------------------------------------------------------------------

export function toLocacaoPropertyFields(
  l: IListListing,
  extras: IListImportExtras = {},
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    kind: kindForPropertyType(l.propertyTypeUid),
    status: "disponivel",
    tipoDimob: "urbano",
    source: "ilist",
    crmId: l.ilistId,
  };
  if (l.streetName) fields.rua = l.streetName;
  if (l.streetNumber) fields.numero = l.streetNumber;
  if (l.city) fields.cidade = l.city;
  // uf tem z.string().length(2) — omitir quando null (nunca enviar "").
  if (l.uf) fields.uf = l.uf;
  if (l.postalCode) fields.cep = l.postalCode;
  if (l.builtArea && l.builtArea > 0) fields.area = l.builtArea;
  const atributos: Record<string, unknown> = {};
  if (l.bedrooms != null) atributos.quartos = l.bedrooms;
  if (l.bathrooms != null) atributos.banheiros = l.bathrooms;
  if (l.parkingSpaces != null) atributos.vagas = l.parkingSpaces;
  if (l.yearBuilt != null) atributos.anoConstrucao = l.yearBuilt;
  if (Object.keys(atributos).length) fields.atributos = atributos;
  if (extras.fotos?.length) fields.fotos = extras.fotos;
  if (extras.descricao) fields.descricaoIa = extras.descricao;
  const price = priceNumber(l);
  if (price !== undefined && l.transactionType === TRANSACTION_TYPE.RENT && isBrlPrice(l)) {
    fields.valorAluguelSugerido = price;
  }
  return fields;
}

// ---------------------------------------------------------------------------
// 2. Vendas — item snake_case de dataJson.imoveis[]
// ---------------------------------------------------------------------------

export function toVendasImovel(
  l: IListListing,
  extras: IListImportExtras = {},
): Record<string, string> {
  // descricao é obrigatória (min 10) no step3Schema — fallback gerado quando a
  // API não tem descrição Web/PTB. Nunca bloquear o import por isso.
  const partes: string[] = [];
  if (l.bedrooms) partes.push(`${l.bedrooms} dorm.`);
  if (l.parkingSpaces) partes.push(`${l.parkingSpaces} vaga(s)`);
  if (l.builtArea) partes.push(`${l.builtArea}m²`);
  const fallback = `Imóvel ${partes.length ? partes.join(", ") + ", " : ""}${formatEndereco(l)} (ref. iList ${l.listingCode ?? l.ilistId})`;
  const descricao =
    extras.descricao && extras.descricao.trim().length >= 10 ? extras.descricao.trim() : fallback;

  return {
    rua: l.streetName ?? "",
    numero: l.streetNumber ?? "",
    complemento: "",
    bairro: "",
    cidade: l.city ?? "",
    uf: l.uf ?? "",
    cep: l.postalCode ?? "",
    // Matrícula/cartório/IPTU não existem no iList — o form público completa.
    matricula: "",
    cartorio: "",
    inscricao_iptu: "",
    sql: "",
    inscricao_municipal: "",
    descricao,
  };
}

// ---------------------------------------------------------------------------
// 3. Proposta — snapshot mínimo
// ---------------------------------------------------------------------------

export interface ProposalImovelSnapshot {
  endereco: string;
  listingCode?: string;
  preco?: number;
  ilistId: string;
}

export function toProposalSnapshot(l: IListListing): ProposalImovelSnapshot {
  const snap: ProposalImovelSnapshot = { endereco: formatEndereco(l), ilistId: l.ilistId };
  if (l.listingCode) snap.listingCode = l.listingCode;
  const price = priceNumber(l);
  if (price !== undefined && isBrlPrice(l)) snap.preco = price;
  return snap;
}

// ---------------------------------------------------------------------------
// Bônus vendas — seed do step de comissão a partir do listing
// ---------------------------------------------------------------------------

export interface ComissaoSeed {
  totalPct?: number;
  corretor?: { nome: string; creci?: string };
}

export function toComissaoSeed(l: IListListing): ComissaoSeed {
  const seed: ComissaoSeed = {};
  if (l.comTotalPct != null && l.comTotalPct > 0) seed.totalPct = l.comTotalPct;
  if (l.associateName) {
    seed.corretor = { nome: l.associateName };
    if (l.associateCreci) seed.corretor.creci = l.associateCreci;
  }
  return seed;
}

/** searchText do espelho: lower(código + endereço + cidade + corretor). */
export function buildSearchText(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== "")
    .map((p) => String(p).toLowerCase())
    .join(" ");
}
