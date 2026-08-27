import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    contractTemplate: { findMany: vi.fn() },
  },
}));

import { propostaModalidadeForSchema, selectPropostaTemplate } from "../template-select";
import { prisma } from "@/lib/db/prisma";

const mockFindMany = vi.mocked(prisma.contractTemplate.findMany);

const tpl = (id: string, matchCriteria: unknown = null, isDefault = false) =>
  ({
    id,
    modalidade: "proposta_locacao_residencial",
    isDefault,
    status: "active",
    matchCriteria,
  }) as never;

describe("propostaModalidadeForSchema", () => {
  it("mapeia os três schemas de proposta", () => {
    expect(propostaModalidadeForSchema("compra_venda_v1")).toBe("proposta_venda");
    expect(propostaModalidadeForSchema("locacao_residencial_v1")).toBe(
      "proposta_locacao_residencial"
    );
    expect(propostaModalidadeForSchema("locacao_comercial_v1")).toBe(
      "proposta_locacao_comercial"
    );
    expect(propostaModalidadeForSchema("administracao_locacao_v1")).toBeNull();
  });
});

describe("selectPropostaTemplate × matchCriteria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const generico = tpl("generico", null, true);
  const fiadorPj = tpl("fiador-pj", { garantia: "fiador", fiadorPessoa: "pj", pessoa: "pf" });
  const semGarantia = tpl("sem-garantia", { garantia: "sem_garantia" });

  it("variante da RE/MAX Ativa: proponente PF com fiador PJ", async () => {
    mockFindMany.mockResolvedValueOnce([generico, semGarantia, fiadorPj]);
    const result = await selectPropostaTemplate("org-1", "locacao_residencial_v1", {
      garantia: { tipo: "fiador", fiador: { tipo_pessoa: "juridica" } },
      locatarios: [{ tipo_pessoa: "fisica" }],
    });
    expect(result?.template.id).toBe("fiador-pj");
  });

  it("proponente PJ descarta a variante marcada como PF", async () => {
    mockFindMany.mockResolvedValueOnce([generico, fiadorPj]);
    const result = await selectPropostaTemplate("org-1", "locacao_residencial_v1", {
      garantia: { tipo: "fiador", fiador: { tipo_pessoa: "juridica" } },
      locatarios: [{ tipo_pessoa: "juridica" }],
    });
    expect(result?.template.id).toBe("generico");
  });

  it("proposta ANTIGA (partes só com nome) → fatos nulos, vence o isDefault", async () => {
    // Compatibilidade: propostas criadas antes da página (sem tipo_pessoa nem
    // garantia) continuam selecionando como sempre — sem regressão.
    mockFindMany.mockResolvedValueOnce([fiadorPj, generico]);
    const result = await selectPropostaTemplate("org-1", "locacao_residencial_v1", {
      locatarios: [{ nome: "Fulano" }],
      locadores: [{ nome: "Ciclano" }],
    });
    expect(result?.template.id).toBe("generico");
  });

  it("REGRESSÃO: sem dataJson e sem criteria, match exato preferindo isDefault", async () => {
    mockFindMany.mockResolvedValueOnce([tpl("p-old"), tpl("p-def", null, true)]);
    const result = await selectPropostaTemplate("org-1", "locacao_residencial_v1");
    expect(result?.template.id).toBe("p-def");
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        orgId: "org-1",
        status: "active",
        modalidade: "proposta_locacao_residencial",
      },
    });
  });

  it("sem template ativo da modalidade → null (sem fallback)", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    expect(await selectPropostaTemplate("org-1", "locacao_residencial_v1")).toBeNull();
  });

  it("schemaType fora do mapa → null sem tocar o banco", async () => {
    expect(await selectPropostaTemplate("org-1", "administracao_locacao_v1")).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("selectPropostaTemplate — garantiaMatched (D16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("true no match exato, false no fallback de outra garantia", async () => {
    const generico = tpl("generico", null, true);
    const fiador = tpl("fiador", { garantia: "fiador" });
    mockFindMany.mockResolvedValueOnce([generico, fiador]);
    const exato = await selectPropostaTemplate("org-1", "locacao_residencial_v1", {
      garantia: { tipo: "fiador" },
    });
    expect(exato?.template.id).toBe("fiador");
    expect(exato?.garantiaMatched).toBe(true);

    mockFindMany.mockResolvedValueOnce([generico, fiador]);
    const fallback = await selectPropostaTemplate("org-1", "locacao_residencial_v1", {
      garantia: { tipo: "seguro_fianca" },
    });
    expect(fallback?.template.id).toBe("generico");
    expect(fallback?.garantiaMatched).toBe(false);
  });

  it("proposta antiga sem garantia → true (nada a casar)", async () => {
    mockFindMany.mockResolvedValueOnce([tpl("generico", null, true)]);
    const result = await selectPropostaTemplate("org-1", "locacao_residencial_v1", {});
    expect(result?.garantiaMatched).toBe(true);
  });
});
