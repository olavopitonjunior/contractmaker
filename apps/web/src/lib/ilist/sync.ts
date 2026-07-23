// Sync do espelho local de listings (pull — a RexAPI não tem webhooks).
// Delta por ModifiedDate (lastCursor − 1h de overlap anti-clock-skew); full
// resync reconcilia deletions (marca deletedAt nos ausentes).

import { prisma } from "@/lib/db/prisma";
import type { IListConnection } from "@prisma/client";
import { createIListClient, fromSentinel, type IListClient } from "./client";
import { buildSearchText } from "./mapping";
import { loadGeoCacheMap, warmGeoCache, type ResolvedCity } from "./geodata";
import type { IListAssociate, IListProperty } from "./types";

const PAGE_SIZE = 100;
// Budget de tempo — rota tem maxDuration 300s; paramos antes e persistimos o
// progresso (syncStatus "syncing" + cursor parcial); o próximo tick continua.
const TIME_BUDGET_MS = 250_000;
// Overlap do delta pra não perder registros na fronteira do cursor.
const CURSOR_OVERLAP_MS = 60 * 60 * 1000;

export interface SyncResult {
  ok: boolean;
  upserted: number;
  markedDeleted: number;
  partial: boolean;
  error?: string;
}

interface AssociateInfo {
  name?: string;
  creci?: string;
}

class SyncTimeBudgetExceeded extends Error {}

function assertBudget(startedAt: number): void {
  if (Date.now() - startedAt > TIME_BUDGET_MS) throw new SyncTimeBudgetExceeded();
}

async function loadAssociateMap(
  client: IListClient,
  officeIds: number[],
  startedAt: number,
): Promise<Map<number, AssociateInfo>> {
  const map = new Map<number, AssociateInfo>();
  for (const officeID of officeIds) {
    let page = 1;
    for (;;) {
      assertBudget(startedAt);
      const res = await client.associates.list({ page, take: PAGE_SIZE, all: true, officeID });
      for (const a of res.Items as IListAssociate[]) {
        map.set(a.ID, { name: a.AgentName, creci: a.SalesLicenseNumber || undefined });
      }
      if (!res.HasNextPage) break;
      page++;
    }
  }
  return map;
}

function parseApiDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function listingData(
  conn: IListConnection,
  p: IListProperty,
  geo: Map<number, ResolvedCity>,
  associates: Map<number, AssociateInfo>,
) {
  const cityId = p.GeoData?.CityID || null;
  const resolved = cityId ? (geo.get(cityId) ?? null) : null;
  const assoc = p.AssociateID ? (associates.get(p.AssociateID) ?? null) : null;
  const price = fromSentinel(p.CurrentListingPrice);
  const listingCode = p.ListingID != null ? String(p.ListingID) : null;

  return {
    externalId: p.ExternalID || null,
    listingCode,
    officeId: p.OfficeID ?? 0,
    associateId: p.AssociateID ?? null,
    transactionType: fromSentinel(p.TransactionType) ?? 0,
    listingStatus: fromSentinel(p.ListingStatus) ?? 0,
    propertyTypeUid: fromSentinel(p.PropertyType) ?? null,
    price: price ?? null,
    currency: p.CurrentListingCurrency || null,
    bedrooms: fromSentinel(p.NumberOfBedrooms) ?? null,
    bathrooms: fromSentinel(p.NumberOfBathrooms) ?? null,
    builtArea: fromSentinel(p.BuiltArea) ?? null,
    lotSizeM2: fromSentinel(p.LotSizeM2) ?? null,
    parkingSpaces: fromSentinel(p.ParkingSpaces) ?? null,
    yearBuilt: fromSentinel(p.YearBuilt) ?? null,
    comTotalPct: fromSentinel(p.ComTotalPct) ?? null,
    comBuyAgentPct: fromSentinel(p.ComBuyAgentPct) ?? null,
    streetName: p.StreetName || null,
    streetNumber: p.StreetNumber || null,
    postalCode: p.PostalCode || null,
    cityId,
    city: resolved?.city ?? null,
    uf: resolved?.uf ?? null,
    associateName: assoc?.name ?? null,
    associateCreci: assoc?.creci ?? null,
    searchText: buildSearchText([
      listingCode,
      p.ExternalID,
      p.StreetName,
      p.StreetNumber,
      resolved?.city,
      resolved?.uf,
      p.PostalCode,
      assoc?.name,
    ]),
    // `raw` = property bruto do LIST endpoint. Associates NUNCA entram aqui
    // (respostas de associate são redigidas no client, e mesmo assim só os
    // escalares name/creci são desnormalizados).
    raw: p as object,
    modifiedAt: parseApiDate(p.ModifiedDate),
    deletedAt: null as Date | null,
    syncedAt: new Date(),
  };
}

export async function syncOrgListings(
  conn: IListConnection,
  opts: { full?: boolean } = {},
): Promise<SyncResult> {
  const startedAt = Date.now();
  const full = opts.full ?? false;
  const client = createIListClient(conn.regionId);

  await prisma.iListConnection.update({
    where: { id: conn.id },
    data: { syncStatus: "syncing" },
  });

  try {
    // Geodata: warm no full ou quando o cache da região está vazio. A fase de
    // preparação (geodata + associates) também respeita o budget de tempo —
    // sem isso, uma org grande estouraria o maxDuration da Vercel antes do
    // catch e deixaria syncStatus travado em "syncing" sem erro registrado.
    const cached = await prisma.iListGeoCity.count({ where: { regionId: conn.regionId } });
    if (full || cached === 0) await warmGeoCache(client);
    assertBudget(startedAt);
    const geo = await loadGeoCacheMap(conn.regionId);
    const associates = await loadAssociateMap(client, conn.officeIds, startedAt);

    // TODO(escala): full sync parcial recomeça do zero no próximo tick (sem
    // cursor de retomada por office/página). Aceitável no volume atual
    // (região 71 ≈ 1.9k listings cabe no budget); antes de provisionar tenant
    // com catálogo muito maior, persistir progresso por (officeID, page).
    const startDate =
      !full && conn.lastCursor ? new Date(conn.lastCursor.getTime() - CURSOR_OVERLAP_MS) : undefined;

    let upserted = 0;
    let maxModified: Date | null = conn.lastCursor ?? null;
    const seenIds = new Set<string>();
    let partial = false;

    for (const officeID of conn.officeIds) {
      let page = 1;
      for (;;) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          partial = true;
          break;
        }
        const res = await client.properties.list({
          page,
          take: PAGE_SIZE,
          all: true, // inclui Cancelled/desabilitados — necessário pra refletir status
          officeID,
          startDate,
        });
        for (const p of res.Items as IListProperty[]) {
          if (!p.ID) continue;
          seenIds.add(p.ID);
          const data = listingData(conn, p, geo, associates);
          await prisma.iListListing.upsert({
            where: { orgId_ilistId: { orgId: conn.orgId, ilistId: p.ID } },
            create: { orgId: conn.orgId, connectionId: conn.id, ilistId: p.ID, ...data },
            update: data,
          });
          upserted++;
          if (data.modifiedAt && (!maxModified || data.modifiedAt > maxModified)) {
            maxModified = data.modifiedAt;
          }
        }
        if (!res.HasNextPage) break;
        page++;
      }
      if (partial) break;
    }

    // Reconciliação de deletions: SÓ no full completo (parcial não pode marcar —
    // ausência pode ser só página não visitada).
    let markedDeleted = 0;
    if (full && !partial) {
      const stale = await prisma.iListListing.findMany({
        where: { connectionId: conn.id, deletedAt: null },
        select: { id: true, ilistId: true },
      });
      const toDelete = stale.filter((s) => !seenIds.has(s.ilistId)).map((s) => s.id);
      if (toDelete.length) {
        const res = await prisma.iListListing.updateMany({
          where: { id: { in: toDelete } },
          data: { deletedAt: new Date() },
        });
        markedDeleted = res.count;
      }
    }

    await prisma.iListConnection.update({
      where: { id: conn.id },
      data: {
        syncStatus: partial ? "syncing" : "ok",
        lastSyncAt: new Date(),
        lastSyncError: null,
        lastCursor: maxModified,
        ...(full && !partial ? { lastFullSyncAt: new Date() } : {}),
      },
    });

    return { ok: true, upserted, markedDeleted, partial };
  } catch (err) {
    if (err instanceof SyncTimeBudgetExceeded) {
      // Budget estourou na preparação — não é erro: persiste "syncing" e o
      // próximo tick (cron/botão) continua.
      await prisma.iListConnection
        .update({ where: { id: conn.id }, data: { syncStatus: "syncing" } })
        .catch(() => {});
      return { ok: true, upserted: 0, markedDeleted: 0, partial: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    await prisma.iListConnection
      .update({
        where: { id: conn.id },
        data: { syncStatus: "error", lastSyncError: message.slice(0, 2000) },
      })
      .catch(() => {});
    return { ok: false, upserted: 0, markedDeleted: 0, partial: false, error: message };
  }
}
