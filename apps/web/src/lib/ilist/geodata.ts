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
 * Baixa todas as cidades da região (multi-criteria paginado) e faz upsert no
 * cache global. Chamado no provisioning e no início do full sync.
 */
export async function warmGeoCache(client: IListClient): Promise<number> {
  let page = 1;
  let total = 0;
  for (;;) {
    const res = await client.geodata.cities(page, 100);
    for (const row of res.Items) {
      if (!row.CityID || !row.CityName) continue;
      await prisma.iListGeoCity.upsert({
        where: { regionId_cityId: { regionId: client.regionId, cityId: row.CityID } },
        create: {
          regionId: client.regionId,
          cityId: row.CityID,
          cityName: row.CityName,
          provinceName: row.ProvinceName ?? "",
          uf: ufForProvince(row.ProvinceName),
        },
        update: {
          cityName: row.CityName,
          provinceName: row.ProvinceName ?? "",
          uf: ufForProvince(row.ProvinceName),
        },
      });
      total++;
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
