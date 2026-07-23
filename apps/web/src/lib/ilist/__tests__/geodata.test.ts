import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O mock global do Prisma (setup.ts) não cobre os models iList — mockamos local.
// vi.hoisted: o factory do vi.mock é içado acima dos consts, então o objeto do
// mock precisa ser criado num bloco hoisted pra ser referenciável nos dois.
const { geoCity } = vi.hoisted(() => ({
  geoCity: { count: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { iListGeoCity: geoCity } }));

import { warmGeoCache } from "../geodata";
import type { IListClient } from "../client";

function pagedClient(pages: Array<{ Items: unknown[]; HasNextPage: boolean; TotalCount: number }>) {
  const cities = vi.fn((page: number) => Promise.resolve(pages[page - 1]));
  return { client: { regionId: 71, geodata: { cities } } as unknown as IListClient, cities };
}

function city(cityId: number, cityName = `City ${cityId}`, provinceName = "São Paulo") {
  return { CityID: cityId, CityName: cityName, ProvinceName: provinceName };
}

describe("warmGeoCache", () => {
  beforeEach(() => {
    geoCity.count.mockReset().mockResolvedValue(0);
    geoCity.createMany.mockReset().mockImplementation((args: { data: unknown[] }) =>
      Promise.resolve({ count: args.data.length }),
    );
  });
  afterEach(() => vi.clearAllMocks());

  it("grava em LOTE (createMany skipDuplicates), não um-a-um", async () => {
    const { client } = pagedClient([
      { Items: [city(1), city(2)], HasNextPage: true, TotalCount: 3 },
      { Items: [city(3)], HasNextPage: false, TotalCount: 3 },
    ]);

    const total = await warmGeoCache(client);

    expect(total).toBe(3);
    expect(geoCity.createMany).toHaveBeenCalledTimes(2); // 1 por página, não por cidade
    expect(geoCity.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
  });

  it("trima nome da cidade e resolve UF via província", async () => {
    const { client } = pagedClient([
      { Items: [{ CityID: 5, CityName: "Vitoria       ", ProvinceName: "Espírito Santo" }], HasNextPage: false, TotalCount: 1 },
    ]);

    await warmGeoCache(client);

    const row = geoCity.createMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({ regionId: 71, cityId: 5, cityName: "Vitoria", uf: "ES" });
  });

  it("chama onProgress ANTES de cada fetch (permite abortar por budget)", async () => {
    const { client, cities } = pagedClient([
      { Items: [city(1)], HasNextPage: true, TotalCount: 2 },
      { Items: [city(2)], HasNextPage: false, TotalCount: 2 },
    ]);
    const onProgress = vi.fn();

    await warmGeoCache(client, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    // aborto no meio propaga (não engole a exceção do budget)
    onProgress.mockReset();
    let call = 0;
    const aborting = vi.fn(() => {
      if (++call === 2) throw new Error("budget");
    });
    const { client: c2 } = pagedClient([
      { Items: [city(1)], HasNextPage: true, TotalCount: 3 },
      { Items: [city(2)], HasNextPage: true, TotalCount: 3 },
    ]);
    await expect(warmGeoCache(c2, aborting)).rejects.toThrow("budget");
  });

  it("retomável barato: cache já completo → 1 chamada, sem re-baixar tudo", async () => {
    geoCity.count.mockResolvedValue(5797); // região já inteira em cache
    const { client, cities } = pagedClient([
      { Items: [city(1)], HasNextPage: true, TotalCount: 5797 },
    ]);

    const total = await warmGeoCache(client);

    expect(cities).toHaveBeenCalledTimes(1); // só a página 1 (pra ler TotalCount)
    expect(geoCity.createMany).not.toHaveBeenCalled(); // nada re-gravado
    expect(total).toBe(5797);
  });
});
