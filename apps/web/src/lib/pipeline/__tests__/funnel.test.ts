import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getFunnelByChannel } from "../funnel";

const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;

describe("getFunnelByChannel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mapeia rows, calcula conversão e ordena por total desc", async () => {
    queryRaw.mockResolvedValue([
      { sourceChannel: "form_publico", total: 10n, won: 4n, lost: 2n, totalValue: 500000 },
      { sourceChannel: "manual", total: 20n, won: 5n, lost: 10n, totalValue: 900000 },
    ]);

    const rows = await getFunnelByChannel({ orgId: "org1", kind: "venda" });

    expect(rows.map((r) => r.channel)).toEqual(["manual", "form_publico"]);
    expect(rows[0]).toMatchObject({
      label: "Cadastro manual",
      total: 20,
      won: 5,
      lost: 10,
      conversionPct: 25,
      totalValue: 900000,
    });
    expect(rows[1].conversionPct).toBe(40);
  });

  it("canal null → bucket 'Anterior ao rastreio'", async () => {
    queryRaw.mockResolvedValue([
      { sourceChannel: null, total: 3n, won: 0n, lost: 1n, totalValue: null },
    ]);
    const rows = await getFunnelByChannel({ orgId: "org1", kind: "venda" });
    expect(rows[0].label).toBe("Anterior ao rastreio");
    expect(rows[0].totalValue).toBe(0);
    expect(rows[0].conversionPct).toBe(0);
  });

  it("sem deals → lista vazia", async () => {
    queryRaw.mockResolvedValue([]);
    const rows = await getFunnelByChannel({ orgId: "org1", kind: "locacao" });
    expect(rows).toEqual([]);
  });
});
