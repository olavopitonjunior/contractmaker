// Resolução de GeoData.CityID → cidade/UF. A RexAPI só devolve o CityID
// numérico no property; nome de cidade e província vêm da hierarquia geodata,
// que baixamos 1x por região (warmGeoCache) pro cache global IListGeoCity.

import { prisma } from "@/lib/db/prisma";
import type { IListClient } from "./client";

// Nome de província (como vem da API, sem padronização garantida) → sigla UF.
// Chave normalizada: lowercase, sem acento. Província fora do mapa → uf null
// (nunca chutar — o import omite o campo).
const PROVINCE_TO_UF: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

export function normalizeProvinceName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function ufForProvince(provinceName: string | undefined | null): string | null {
  if (!provinceName) return null;
  return PROVINCE_TO_UF[normalizeProvinceName(provinceName)] ?? null;
}

/**
 * Baixa todas as cidades da região (multi-criteria paginado) e grava no cache
 * global em LOTE. Uma região RE/MAX referencia milhares de cidades (a 71 tem
 * ~2000); com upsert um-a-um o warm sozinho estoura o maxDuration de 300s da
 * Vercel (2000 × ~200ms). Por isso: `createMany({ skipDuplicates })` por página
 * (1 round-trip por página em vez de 100). Nome de cidade praticamente nunca
 * muda — inserir-e-ignorar-duplicata é suficiente para um cache.
 *
 * `onProgress` é chamado a cada página para o chamador poder abortar por budget
 * de tempo (lança) antes de a função varrer a região inteira.
 */
export async function warmGeoCache(
  client: IListClient,
  onProgress?: () => void,
): Promise<number> {
  let page = 1;
  let total = 0;
  for (;;) {
    onProgress?.();
    const res = await client.geodata.cities(page, 100);
    const rows = res.Items.filter((r) => r.CityID && r.CityName).map((r) => ({
      regionId: client.regionId,
      cityId: r.CityID,
      cityName: r.CityName,
      provinceName: r.ProvinceName ?? "",
      uf: ufForProvince(r.ProvinceName),
    }));
    if (rows.length) {
      const res2 = await prisma.iListGeoCity.createMany({ data: rows, skipDuplicates: true });
      total += res2.count;
    }
    if (!res.HasNextPage) break;
    page++;
  }
  return total;
}

export interface ResolvedCity {
  city: string;
  uf: string | null;
}

/** Lê o cache — miss → null (sem fetch pontual dentro de loops). */
export async function resolveCity(
  regionId: number,
  cityId: number | undefined | null,
): Promise<ResolvedCity | null> {
  if (!cityId) return null;
  const row = await prisma.iListGeoCity.findUnique({
    where: { regionId_cityId: { regionId, cityId } },
  });
  if (!row) return null;
  return { city: row.cityName, uf: row.uf };
}

/** Carrega o cache inteiro da região num Map (uso no sync — evita N queries). */
export async function loadGeoCacheMap(regionId: number): Promise<Map<number, ResolvedCity>> {
  const rows = await prisma.iListGeoCity.findMany({ where: { regionId } });
  return new Map(rows.map((r) => [r.cityId, { city: r.cityName, uf: r.uf }]));
}
