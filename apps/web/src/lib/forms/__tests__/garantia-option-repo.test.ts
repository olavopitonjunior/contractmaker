import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  listGarantiaOptions,
  seedDefaultGarantiaOptions,
} from "../garantia-option-repo";
import { DEFAULT_GARANTIA_OPTIONS } from "../garantia-catalog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  p.garantiaOption = {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 4 }),
  };
});

describe("listGarantiaOptions", () => {
  it("org sem catálogo cai nos defaults (não devolve lista vazia)", async () => {
    const options = await listGarantiaOptions("org-1");
    expect(options).toHaveLength(DEFAULT_GARANTIA_OPTIONS.length);
    expect(options.map((o) => o.provider)).toEqual([
      "Tokio Marine",
      "Porto Seguro",
      "Pottencial",
      "Too",
    ]);
    // Default não tem id — a UI usa isso pra marcar "sugerida".
    expect(options.every((o) => !o.id)).toBe(true);
  });

  it("org com catálogo próprio manda (defaults saem de cena)", async () => {
    p.garantiaOption.findMany.mockResolvedValue([
      {
        id: "g1",
        tipo: "seguro_fianca",
        provider: "Pottencial",
        label: null,
        active: true,
        position: 0,
      },
    ]);
    const options = await listGarantiaOptions("org-1");
    expect(options).toHaveLength(1);
    expect(options[0].provider).toBe("Pottencial");
  });

  it("activeOnly filtra desativadas (o form não oferece o que saiu do ar)", async () => {
    p.garantiaOption.findMany.mockResolvedValue([
      { id: "g1", tipo: "seguro_fianca", provider: "Porto Seguro", label: null, active: true, position: 0 },
      { id: "g2", tipo: "seguro_fianca", provider: "Loft", label: null, active: false, position: 1 },
    ]);
    const todas = await listGarantiaOptions("org-1");
    const ativas = await listGarantiaOptions("org-1", { activeOnly: true });
    expect(todas).toHaveLength(2);
    expect(ativas).toHaveLength(1);
    expect(ativas[0].provider).toBe("Porto Seguro");
  });

  it("busca escopada na org (sem cross-org)", async () => {
    await listGarantiaOptions("org-42");
    expect(p.garantiaOption.findMany.mock.calls[0][0].where).toEqual({
      orgId: "org-42",
    });
  });
});

describe("seedDefaultGarantiaOptions", () => {
  it("semeia os 4 defaults e é idempotente (skipDuplicates)", async () => {
    await seedDefaultGarantiaOptions("org-nova");
    const arg = p.garantiaOption.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(4);
    expect(arg.data.every((d: { orgId: string }) => d.orgId === "org-nova")).toBe(true);
    expect(arg.data.every((d: { tipo: string }) => d.tipo === "seguro_fianca")).toBe(true);
  });
});
