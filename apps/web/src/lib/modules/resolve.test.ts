import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  moduleForDealKind,
  moduleForSchemaType,
  pipelineKind,
  getPipelineByKind,
} from "./resolve";
import { MODULE } from "./catalog";

const findFirst = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;

describe("moduleForDealKind", () => {
  it("mapeia kind do banco para chave de módulo", () => {
    expect(moduleForDealKind("locacao")).toBe(MODULE.LOCACAO);
    expect(moduleForDealKind("venda")).toBe(MODULE.VENDAS);
    expect(moduleForDealKind(null)).toBe(MODULE.VENDAS);
    expect(moduleForDealKind(undefined)).toBe(MODULE.VENDAS);
  });
});

describe("moduleForSchemaType", () => {
  it("locacao_* => locacao, resto => vendas", () => {
    expect(moduleForSchemaType("locacao_residencial_v1")).toBe(MODULE.LOCACAO);
    expect(moduleForSchemaType("locacao_comercial_v2")).toBe(MODULE.LOCACAO);
    expect(moduleForSchemaType("venda_padrao")).toBe(MODULE.VENDAS);
    expect(moduleForSchemaType(null)).toBe(MODULE.VENDAS);
  });
});

describe("pipelineKind", () => {
  it("traduz módulo para o kind SINGULAR do banco", () => {
    expect(pipelineKind(MODULE.VENDAS)).toBe("venda");
    expect(pipelineKind(MODULE.LOCACAO)).toBe("locacao");
  });
});

describe("getPipelineByKind", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sempre inclui o kind correto no where (venda)", async () => {
    findFirst.mockResolvedValue({ id: "p1" });
    await getPipelineByKind("org1", MODULE.VENDAS, {
      include: { stages: true },
    });
    expect(findFirst).toHaveBeenCalledWith({
      include: { stages: true },
      where: { orgId: "org1", kind: "venda" },
    });
  });

  it("mapeia locacao para kind locacao e preserva where extra do chamador", async () => {
    findFirst.mockResolvedValue({ id: "p2" });
    await getPipelineByKind("org2", MODULE.LOCACAO, {
      where: { name: "X" },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { name: "X", orgId: "org2", kind: "locacao" },
    });
  });
});
