import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks (içados) --------------------------------------------------------
const m = vi.hoisted(() => {
  const links = new Map<string, { remoteId: string; remoteAux: string | null }>();
  type Row = { id: string; status: string; startedAt: Date; vendaId: string | null; lastError: string | null };
  const rows = new Map<string, Row>(); // por dealId
  const prisma = {
    deal: { findFirst: vi.fn() },
    superlogicaAccount: { findUnique: vi.fn() },
    superlogicaLink: {
      findUnique: vi.fn(async ({ where }: { where: { orgId_entityType_localKey: { entityType: string; localKey: string } } }) => {
        const k = where.orgId_entityType_localKey;
        const v = links.get(`${k.entityType}|${k.localKey}`);
        return v ? { remoteId: v.remoteId, remoteAux: v.remoteAux } : null;
      }),
      upsert: vi.fn(async ({ where, create }: { where: { orgId_entityType_localKey: { entityType: string; localKey: string } }; create: { remoteId: string; remoteAux: string | null } }) => {
        const k = where.orgId_entityType_localKey;
        links.set(`${k.entityType}|${k.localKey}`, { remoteId: create.remoteId, remoteAux: create.remoteAux ?? null });
        return {};
      }),
    },
    superlogicaExport: {
      create: vi.fn(async ({ data }: { data: { dealId: string; status: string; startedAt: Date } }) => {
        if (rows.has(data.dealId)) {
          const err = Object.assign(new Error("Unique constraint"), { code: "P2002" });
          Object.setPrototypeOf(err, PrismaKnown.prototype);
          throw err;
        }
        const row: Row = { id: `exp-${data.dealId}`, status: data.status, startedAt: data.startedAt, vendaId: null, lastError: null };
        rows.set(data.dealId, row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; OR: Array<{ status: string; startedAt?: { lt: Date } }> }; data: Partial<Row> }) => {
        const row = [...rows.values()].find((r) => r.id === where.id);
        if (!row) return { count: 0 };
        const ok = where.OR.some((c) => c.status === row.status && (!c.startedAt || row.startedAt < c.startedAt.lt));
        if (!ok) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = [...rows.values()].find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    pipelineStage: { findFirst: vi.fn(async () => ({ id: "stage_cob" })) },
  };
  // Prisma.PrismaClientKnownRequestError precisa existir para o instanceof do claim.
  class PrismaKnown extends Error {
    code = "P2002";
  }
  const escrita = {
    pessoas: {
      findByDoc: vi.fn(async () => null),
      createProprietario: vi.fn(async (input: { ST_NOME_PES: string }) => ({ data: { id_pessoa_pes: `P-${input.ST_NOME_PES}`, st_nome_pes: input.ST_NOME_PES }, msg: "" })),
      createCorretor: vi.fn(async (input: { ST_NOME_PES: string }) => ({ data: { id_pessoa_pes: `C-${input.ST_NOME_PES}` }, msg: "" })),
      findCorretorById: vi.fn(async (id: string) => ({ id_pessoa_pes: id, id_favorecido_fav: `F-${id}`, st_nome_pes: "x" })),
    },
    imoveis: {
      findByIdentificador: vi.fn(async () => null),
      create: vi.fn(async () => ({ data: { id_imovel_imo: "IMO-1" }, msg: "" })),
    },
    vendas: {
      create: vi.fn(async () => ({ data: { id_venda_ven: "745" }, msg: "" })),
      get: vi.fn(async () => ({ id_venda_ven: "745", vl_total_ven: "420000.00", vendedores: [], comissoes: [], comissao_parcelas: [] })),
      update: vi.fn(),
      excluir: vi.fn(),
      lancarDespesa: vi.fn(),
    },
  };
  const moveDealStage = vi.fn(async () => ({ moved: true }));
  const audit = vi.fn(async () => {});
  return { prisma, escrita, links, rows, moveDealStage, audit, PrismaKnown };
});

vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return { ...actual, Prisma: { ...actual.Prisma, PrismaClientKnownRequestError: m.PrismaKnown } };
});
vi.mock("@/lib/db/prisma", () => ({ prisma: m.prisma }));
vi.mock("@/lib/security/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/pipeline/move-stage", () => ({ moveDealStage: m.moveDealStage }));
vi.mock("../account", () => ({
  decryptAccountCreds: () => ({ appToken: "a", accessToken: "b", licenca: "adm037585" }),
  superlogicaVendaUrl: (id: string) => `https://apps.superlogica.net/imobiliaria/vendas/id/${id}`,
}));
vi.mock("../resources", () => ({ createSuperlogicaClient: () => ({ escrita: m.escrita }) }));

import { SuperlogicaDuplicateError } from "../client";
import { exportDeal, previewDealExport, ExportNotAllowedError } from "../export/export-deal";
import { VendaExportBlockedError } from "../export/build-venda-payload";

const FORM = {
  vendedores: [{ tipo_pessoa: "fisica", nome: "Maria", cpf: "123.456.789-09" }],
  compradores: [{ tipo_pessoa: "juridica", razao_social: "Compradora Ltda", cnpj: "12.345.678/0001-95" }],
  imoveis: [{ rua: "Rua X", numero: "1", bairro: "Centro", cidade: "SP", uf: "SP", cep: "01001-000", descricao: "Casa térrea grande" }],
  pagamento: { valor_total: 420000 },
  comissao: {
    valor: 12600,
    quem_paga: "vendedor",
    prazo_dias_apos_marco: 10,
    comissionados: [
      { nome: "Marcelo", cpf: "333.333.333-33", percentual: 60, papel: "intermediador" },
      { nome: "Imob", cnpj: "98.765.432/0001-10", percentual: 40, papel: "imobiliaria_principal" },
    ],
  },
};

const ACCOUNT = {
  status: "connected",
  contaBancariaId: 6,
  filialId: 0,
  tipoImovelPadrao: 4,
  tipoPagamentoComissao: 0,
  tipoRecebimentoComissao: 0,
  emitirNf: false,
  gerarDimob: false,
  vencimentoDias: 7,
  tetoValorCents: 500_000_000,
};

function dealRow(over: Record<string, unknown> = {}) {
  return {
    id: "deal1",
    title: "Venda Rua X",
    value: 420000,
    kind: "venda",
    stageId: "stage_ass",
    pipelineId: "pipe1",
    contractSignedAt: null,
    stage: { name: "Contrato assinado" },
    form: { dataJson: FORM },
    envelopes: [{ closedAt: new Date("2026-09-03T15:00:00Z") }],
    commissionCharges: [],
    superlogicaExport: null,
    ...over,
  };
}

function withExistingRow(status: string, startedAt = new Date(), vendaId: string | null = null) {
  const row = { id: "exp-deal1", status, startedAt, vendaId, lastError: null };
  m.rows.set("deal1", row);
  return row;
}

beforeEach(() => {
  m.links.clear();
  m.rows.clear();
  m.prisma.deal.findFirst.mockReset().mockResolvedValue(dealRow());
  m.prisma.superlogicaAccount.findUnique.mockReset().mockResolvedValue(ACCOUNT);
  for (const fn of Object.values(m.escrita.pessoas)) fn.mockClear();
  for (const fn of Object.values(m.escrita.imoveis)) fn.mockClear();
  for (const fn of Object.values(m.escrita.vendas)) fn.mockClear();
  m.escrita.pessoas.findByDoc.mockResolvedValue(null);
  m.escrita.vendas.create.mockResolvedValue({ data: { id_venda_ven: "745" }, msg: "" });
  m.moveDealStage.mockClear();
  m.audit.mockClear();
});

describe("previewDealExport", () => {
  it("não escreve nada e devolve espelho + avisos + canExport", async () => {
    const p = await previewDealExport("org1", "deal1");
    expect(p.canExport).toBe(true);
    expect(p.stageAllowed).toBe(true);
    expect(p.exportableStages).toEqual(["Contrato assinado", "Cobrança emitida"]);
    expect(p.resumo.compradores[0]).toEqual({ nome: "Compradora Ltda", documento: "**.345.678/0001-**" });
    expect(p.resumo.comissaoTotal).toBe(12600);
    expect(p.resumo.dataVenda).toEqual(new Date("2026-09-03T15:00:00Z"));
    expect(m.escrita.pessoas.createProprietario).not.toHaveBeenCalled();
    expect(m.escrita.vendas.create).not.toHaveBeenCalled();
  });

  it("stage fora da janela → canExport=false, sem lançar", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ stage: { name: "Formulário" } }));
    const p = await previewDealExport("org1", "deal1");
    expect(p.stageAllowed).toBe(false);
    expect(p.canExport).toBe(false);
  });

  it("cobrança Asaas ativa bloqueia (exclusividade Asaas × Superlógica)", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ stage: { name: "Cobrança emitida" }, commissionCharges: [{ id: "ch1" }] }));
    const p = await previewDealExport("org1", "deal1");
    expect(p.canExport).toBe(false);
    expect(p.warnings.find((w) => w.code === "cobranca_asaas_ativa")?.blocking).toBe(true);
  });

  it("exportação em andamento aparece no preview e desliga o botão", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ superlogicaExport: withExistingRow("running") }));
    const p = await previewDealExport("org1", "deal1");
    expect(p.existing?.status).toBe("running");
    expect(p.canExport).toBe(false);
    expect(p.warnings.map((w) => w.code)).toContain("exportacao_em_andamento");
  });

  it("negócio de locação ou conta desconectada → ExportNotAllowedError 409", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ kind: "locacao" }));
    await expect(previewDealExport("org1", "deal1")).rejects.toBeInstanceOf(ExportNotAllowedError);
    m.prisma.deal.findFirst.mockResolvedValue(dealRow());
    m.prisma.superlogicaAccount.findUnique.mockResolvedValue(null);
    await expect(previewDealExport("org1", "deal1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("exportDeal", () => {
  it("cria pessoas → corretores (com favorecido) → imóvel → venda, grava links, move o stage e audita", async () => {
    const r = await exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" });
    expect(r).toMatchObject({ vendaId: "745", alreadyExported: false, movedToStage: "Cobrança emitida" });
    expect(r.url).toContain("/vendas/id/745");
    expect(m.escrita.pessoas.createProprietario).toHaveBeenCalledTimes(2);
    expect(m.escrita.pessoas.createCorretor).toHaveBeenCalledTimes(2);
    expect(m.escrita.pessoas.findCorretorById).toHaveBeenCalledTimes(2);
    const imovel = m.escrita.imoveis.create.mock.calls[0][0] as { ST_IDENTIFICADOR_IMO: string; PROPRIETARIOS_BENEFICIARIOS: Array<{ ID_PESSOA_PES: string }> };
    expect(imovel.ST_IDENTIFICADOR_IMO).toBe("cm:deal1");
    expect(imovel.PROPRIETARIOS_BENEFICIARIOS[0].ID_PESSOA_PES).toBe("P-Maria");
    const venda = m.escrita.vendas.create.mock.calls[0][0] as Record<string, unknown> & { VENDAS_COMPRADORES: Array<{ ID_PESSOA_PES: string }>; VENDEDORES: Array<{ ID_VENDEDOR_VEV: string; ID_FAVORECIDO_FAV: string }> };
    expect(venda.ID_IMOVEL_IMO).toBe("IMO-1");
    expect(venda.DT_VENDA_VEN).toBe("09/03/2026");
    expect(venda.VENDAS_COMPRADORES[0].ID_PESSOA_PES).toBe("P-Compradora Ltda");
    expect(venda.VENDEDORES.map((v) => [v.ID_VENDEDOR_VEV, v.ID_FAVORECIDO_FAV])).toEqual([["C-Marcelo", "F-C-Marcelo"], ["C-Imob", "F-C-Imob"]]);
    expect(m.links.get("pessoa|pessoa:12345678909")?.remoteId).toBe("P-Maria");
    expect(m.links.get("corretor|corretor:33333333333")).toEqual({ remoteId: "C-Marcelo", remoteAux: "F-C-Marcelo" });
    expect(m.links.get("imovel|deal:deal1")?.remoteId).toBe("IMO-1");
    expect(m.links.get("venda|deal:deal1")?.remoteId).toBe("745");
    const row = m.rows.get("deal1")!;
    expect(row.status).toBe("done");
    expect(row.vendaId).toBe("745");
    expect(m.moveDealStage).toHaveBeenCalledWith(expect.objectContaining({ dealId: "deal1", toStageId: "stage_cob", reason: "superlogica_export" }));
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "SUPERLOGICA_VENDA_CREATED" }));
  });

  it("retomada: reutiliza links (inclusive a VENDA) e pessoa achada por documento; não recria nem re-posta", async () => {
    m.links.set("pessoa|pessoa:12345678909", { remoteId: "3883", remoteAux: null });
    m.links.set("corretor|corretor:33333333333", { remoteId: "115", remoteAux: "204" });
    m.links.set("imovel|deal:deal1", { remoteId: "2088", remoteAux: null });
    m.links.set("venda|deal:deal1", { remoteId: "744", remoteAux: null });
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ superlogicaExport: withExistingRow("error") }));
    m.escrita.pessoas.findByDoc.mockImplementation(async (doc: string) =>
      doc === "12345678000195" ? { id_pessoa_pes: "3882", st_nome_pes: "Compradora Ltda" } : null
    );
    const r = await exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" });
    expect(r.vendaId).toBe("744");
    expect(m.escrita.pessoas.createProprietario).not.toHaveBeenCalled();
    expect(m.escrita.imoveis.create).not.toHaveBeenCalled();
    expect(m.escrita.vendas.create).not.toHaveBeenCalled();
    expect(m.escrita.pessoas.createCorretor).toHaveBeenCalledTimes(1);
    expect(m.rows.get("deal1")?.status).toBe("done");
  });

  it("anti-duplicidade da Superlógica vira sucesso com a venda existente", async () => {
    m.escrita.vendas.create.mockRejectedValue(new SuperlogicaDuplicateError("744", "Já existe uma venda… Venda#744", "vendas/put"));
    const r = await exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" });
    expect(r.vendaId).toBe("744");
    expect(m.rows.get("deal1")?.status).toBe("done");
  });

  it("já exportado (done) → idempotente, sem chamadas à API", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ superlogicaExport: withExistingRow("done", new Date(), "745") }));
    const r = await exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" });
    expect(r).toMatchObject({ vendaId: "745", alreadyExported: true });
    expect(m.escrita.vendas.create).not.toHaveBeenCalled();
  });

  it("claim atômico: running recente → 409 sem tocar na API; running abandonado → assume", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ superlogicaExport: withExistingRow("running") }));
    await expect(exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" })).rejects.toMatchObject({ status: 409 });
    expect(m.escrita.pessoas.createProprietario).not.toHaveBeenCalled();
    m.rows.clear();
    const old = new Date(Date.now() - 10 * 60_000);
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ superlogicaExport: withExistingRow("running", old) }));
    const r = await exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" });
    expect(r.vendaId).toBe("745");
  });

  it("corrida na criação do registro (P2002) → 409 para o perdedor", async () => {
    // Simula: o contexto foi lido sem registro, mas outro processo criou antes do nosso create.
    m.rows.set("deal1", { id: "exp-deal1", status: "running", startedAt: new Date(), vendaId: null, lastError: null });
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ superlogicaExport: null }));
    await expect(exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" })).rejects.toMatchObject({ status: 409 });
    expect(m.escrita.pessoas.createProprietario).not.toHaveBeenCalled();
  });

  it("stage fora da janela → 409; sem conta bancária ou cobrança Asaas ativa → bloqueado antes de escrever", async () => {
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ stage: { name: "Formulário" } }));
    await expect(exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" })).rejects.toMatchObject({ status: 409 });
    m.prisma.deal.findFirst.mockResolvedValue(dealRow());
    m.prisma.superlogicaAccount.findUnique.mockResolvedValue({ ...ACCOUNT, contaBancariaId: null });
    await expect(exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" })).rejects.toBeInstanceOf(VendaExportBlockedError);
    m.prisma.superlogicaAccount.findUnique.mockResolvedValue(ACCOUNT);
    m.prisma.deal.findFirst.mockResolvedValue(dealRow({ commissionCharges: [{ id: "ch1" }] }));
    await expect(exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" })).rejects.toBeInstanceOf(VendaExportBlockedError);
    expect(m.escrita.pessoas.createProprietario).not.toHaveBeenCalled();
    expect(m.rows.size).toBe(0);
  });

  it("falha no meio → registro error com a mensagem, audit FAILURE, e o que já criou fica linkado", async () => {
    m.escrita.imoveis.create.mockRejectedValueOnce(new Error("Superlógica caiu"));
    await expect(exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" })).rejects.toThrow(/caiu/);
    expect(m.rows.get("deal1")?.status).toBe("error");
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "SUPERLOGICA_VENDA_FAILED" }));
    expect(m.links.get("pessoa|pessoa:12345678909")?.remoteId).toBe("P-Maria");
    expect(m.escrita.vendas.create).not.toHaveBeenCalled();
  });

  it("corretor sem favorecido na Superlógica → 422 tipado, nada de venda", async () => {
    m.escrita.pessoas.findCorretorById.mockResolvedValueOnce({ id_pessoa_pes: "C-Marcelo", id_favorecido_fav: "" });
    await expect(exportDeal({ orgId: "org1", dealId: "deal1", userId: "u1" })).rejects.toMatchObject({ name: "ExportNotAllowedError", status: 422 });
    expect(m.escrita.vendas.create).not.toHaveBeenCalled();
  });
});
