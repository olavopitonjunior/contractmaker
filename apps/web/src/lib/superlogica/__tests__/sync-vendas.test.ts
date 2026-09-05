import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const PrismaKnown = Prisma.PrismaClientKnownRequestError;

/**
 * O cron de liquidação chama `vendas/lancardespesa`, que move dinheiro de
 * verdade. Os testes que importam aqui não são os do caminho feliz: são os que
 * provam que uma segunda execução NÃO paga o comissionado de novo, e que um
 * estado que o código não entende não vira "pagou".
 */

const m = vi.hoisted(() => {
  const links = new Map<string, { remoteId: string; remoteAux: string | null }>();
  const exportRows = [
    { id: "exp-1", orgId: "org-1", dealId: "deal-1", vendaId: "746" },
  ];
  return {
    links,
    exportRows,
    venda: { current: null as unknown },
    // FORMA REAL da resposta de escrita: `{ data, msg }` — não `{ id }`. O mock
    // achatado escondia um bug de verdade (o código lia `created.id`, que nunca
    // existe, e sintetizava um id falso para TODO lançamento bem-sucedido).
    lancarDespesa: vi.fn(async () => ({ data: { id_movimento_mov: "67637" }, msg: "" })),
    moveDealStage: vi.fn(async () => ({ moved: true })),
    prisma: {
      superlogicaExport: {
        findMany: vi.fn(async () => exportRows),
        update: vi.fn(async () => ({})),
      },
      superlogicaAccount: {
        findUnique: vi.fn(async () => ({
          orgId: "org-1",
          status: "connected",
          licenca: "adm000000",
          appTokenEncrypted: "a",
          appTokenIvBase64: "b",
          appTokenTagBase64: "c",
          accessTokenEncrypted: "d",
          accessTokenIvBase64: "e",
          accessTokenTagBase64: "f",
          contaBancariaId: 6,
          contaContabilComissao: "2.2.1",
          contaContabilDescricao: "Comissões",
        })),
      },
      superlogicaLink: {
        // `create` com unique é o que serializa duas execuções do cron: a
        // segunda toma P2002 e desiste. O mock reproduz isso.
        create: vi.fn(async ({ data }: { data: { entityType: string; localKey: string; remoteId: string } }) => {
          const k = `${data.entityType}|${data.localKey}`;
          if (links.has(k)) {
            const err = Object.assign(new PrismaKnown("Unique constraint", { code: "P2002", clientVersion: "5" }), {});
            throw err;
          }
          links.set(k, { remoteId: data.remoteId, remoteAux: null });
          return { id: `link-${links.size}` };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { remoteId: string; remoteAux: string | null } }) => {
          const entry = [...links.entries()].find((_, i) => `link-${i + 1}` === where.id);
          if (entry) links.set(entry[0], { remoteId: data.remoteId, remoteAux: data.remoteAux });
          return {};
        }),
      },
      deal: { findUnique: vi.fn(async () => ({ pipelineId: "pipe-1", stage: { name: "Cobrança emitida" } })) },
      pipelineStage: { findFirst: vi.fn(async () => ({ id: "stage-paga" })) },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: m.prisma }));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/pipeline/move-stage", () => ({ moveDealStage: m.moveDealStage }));
vi.mock("../account", () => ({
  decryptAccountCreds: () => ({ licenca: "adm000000", appToken: "x", accessToken: "y" }),
}));
vi.mock("../resources", () => ({
  createSuperlogicaClient: () => ({
    escrita: {
      vendas: {
        get: async () => m.venda.current,
        lancarDespesa: m.lancarDespesa,
      },
    },
  }),
}));

import {
  comissionadosDaVenda,
  extrairIdLancamento,
  parcelaLiquidada,
  parseSuperlogicaDate,
  syncSuperlogicaVendas,
  vendaEncerrada,
} from "../export/sync-vendas";
import type { SLVenda } from "../types";

/** Venda ativa com uma parcela e um comissionado com favorecido. */
function venda(over: Partial<SLVenda> = {}): SLVenda {
  return {
    id_venda_ven: "746",
    fl_status_ven: "",
    comissao_parcelas: [{ id_recebimento_recb: "60344", fl_status_recb: "0", dt_vencimento_recb: "09/12/2026" }],
    vendedores: [{ id_vendedor_vev: "3886", id_favorecido_fav: "2320", st_nome_pes: "Imobiliária Teste" }],
    comissoes: [{ id_item_vei: "4894", id_favorecido_fav: "2320", vl_item_vei: "30000.00" }],
    ...over,
  };
}
function liquidada(): SLVenda {
  return venda({
    comissao_parcelas: [
      { id_recebimento_recb: "60344", fl_status_recb: "1", dt_liquidacao_recb: "09/10/2026" },
    ],
  });
}

describe("leitura do estado remoto", () => {
  it("só conta parcela com o status exato de liquidada", () => {
    expect(parcelaLiquidada(venda())).toBeNull();
    expect(parcelaLiquidada(liquidada())?.id_recebimento_recb).toBe("60344");
    // Fail-closed: status que o código não conhece NÃO é liquidação.
    for (const desconhecido of ["", "3", "9", "liquidado", "01"]) {
      const v = venda({ comissao_parcelas: [{ fl_status_recb: desconhecido }] });
      expect(parcelaLiquidada(v)).toBeNull();
    }
  });

  it("só declara encerrada com status conhecido — ausência é 'não sei'", () => {
    expect(vendaEncerrada(venda())).toBe(false);
    expect(vendaEncerrada(venda({ fl_status_ven: "2" }))).toBe(false); // pendente segue viva
    expect(vendaEncerrada(venda({ fl_status_ven: "1" }))).toBe(true);
    expect(vendaEncerrada(venda({ fl_status_ven: "-1" }))).toBe(true);
    // Resposta vazia pode ser rate limit ou permissão momentânea. Marcar erro
    // aqui tiraria a venda da varredura para sempre.
    expect(vendaEncerrada(null)).toBe(false);
  });

  it("ignora comissionado sem favorecido, sem valor ou com valor ilegível", () => {
    expect(comissionadosDaVenda(venda())).toHaveLength(1);
    expect(comissionadosDaVenda(venda({ vendedores: [{ st_nome_pes: "Sem favorecido" }] }))).toHaveLength(0);
    expect(comissionadosDaVenda(venda({ comissoes: [{ id_favorecido_fav: "2320", vl_item_vei: "0.00" }] }))).toHaveLength(0);
    // `Number("mil reais") <= 0` é falso — sem teste de finitude isso viraria
    // o VL_VALOR_MOV de um lançamento financeiro.
    expect(comissionadosDaVenda(venda({ comissoes: [{ id_favorecido_fav: "2320", vl_item_vei: "mil reais" }] }))).toHaveLength(0);
  });

  it("casa com o item de COMISSÃO, não com a despesa já lançada do mesmo favorecido", () => {
    const v = venda({
      comissoes: [
        { id_favorecido_fav: "2320", vl_item_vei: "999.00", fl_despesa: "1", fl_tipo_vei: "2" },
        { id_favorecido_fav: "2320", vl_item_vei: "30000.00", fl_despesa: "0", fl_tipo_vei: "3" },
      ],
    });
    expect(comissionadosDaVenda(v)[0].valor).toBe("30000.00");
  });

  it("lê o id do lançamento de dentro de `data`, que é a forma real da resposta", () => {
    expect(extrairIdLancamento({ data: { id_movimento_mov: "67637" }, msg: "" })).toBe("67637");
    expect(extrairIdLancamento({ data: [{ id_movimento_mov: "67637" }] })).toBe("67637");
    // A forma achatada (`{ id }`) NÃO é a real — não deve ser lida como id.
    expect(extrairIdLancamento({ id: "67637" })).toBe("");
    expect(extrairIdLancamento({ data: {} })).toBe("");
    expect(extrairIdLancamento(null)).toBe("");
  });

  it("lê as datas da Superlógica no formato que ela devolve", () => {
    expect(parseSuperlogicaDate("09/10/2026")?.getMonth()).toBe(8); // setembro
    expect(parseSuperlogicaDate("09/10/2026")?.getDate()).toBe(10);
    expect(parseSuperlogicaDate("2026-09-10")?.getDate()).toBe(10);
    expect(parseSuperlogicaDate("")).toBeNull();
    expect(parseSuperlogicaDate(null)).toBeNull();
  });
});

describe("syncSuperlogicaVendas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.links.clear();
    m.lancarDespesa.mockResolvedValue({ id: "mov-1" });
  });

  it("parcela aberta: não move o negócio nem lança despesa", async () => {
    m.venda.current = venda();

    const report = await syncSuperlogicaVendas();

    expect(report.outcomes[0].result).toBe("pendente");
    expect(m.lancarDespesa).not.toHaveBeenCalled();
    expect(m.moveDealStage).not.toHaveBeenCalled();
  });

  it("parcela liquidada: lança a despesa uma vez e move para Comissão paga", async () => {
    m.venda.current = liquidada();

    const report = await syncSuperlogicaVendas();

    expect(report.liquidadas).toBe(1);
    expect(report.despesasLancadas).toBe(1);
    expect(m.lancarDespesa).toHaveBeenCalledTimes(1);
    const payload = m.lancarDespesa.mock.calls[0][0] as Record<string, string>;
    expect(payload.ID_FAVORECIDO_FAV).toBe("2320");
    expect(payload.VL_VALOR_MOV).toBe("30000.00");
    expect(payload.ST_CONTA_CONT).toBe("2.2.1");
    expect(payload.DT_VENCIMENTO_MOV).toBe("09/10/2026"); // data da liquidação, não hoje
    expect(m.moveDealStage).toHaveBeenCalledTimes(1);
    expect((m.moveDealStage.mock.calls[0][0] as { reason: string }).reason).toBe("superlogica_liquidacao");
  });

  it("execução repetida NÃO lança a despesa de novo", async () => {
    m.venda.current = liquidada();
    await syncSuperlogicaVendas();
    expect(m.lancarDespesa).toHaveBeenCalledTimes(1);

    // Segundo tick: o link da despesa já existe.
    m.lancarDespesa.mockClear();
    const report = await syncSuperlogicaVendas();

    expect(m.lancarDespesa).not.toHaveBeenCalled();
    expect(report.despesasLancadas).toBe(0);
  });

  it("venda cancelada lá: exportação vira erro e o funil NÃO se mexe", async () => {
    m.venda.current = venda({ fl_status_ven: "1" });

    const report = await syncSuperlogicaVendas();

    expect(report.canceladas).toBe(1);
    expect(m.moveDealStage).not.toHaveBeenCalled();
    const update = m.prisma.superlogicaExport.update.mock.calls[0][0] as { data: { status: string; lastError: string } };
    expect(update.data.status).toBe("error");
    expect(update.data.lastError).toContain("746");
  });

  it("falha no lançamento NÃO libera a reserva — pagar duas vezes é pior que não pagar", async () => {
    m.venda.current = liquidada();
    m.lancarDespesa.mockRejectedValueOnce(new Error("500 do provedor"));

    const report = await syncSuperlogicaVendas();

    expect(report.erros).toBe(1);
    expect(report.outcomes[0].message).toContain("500 do provedor");
    // A reserva fica: a Superlógica pode ter processado antes de a resposta se
    // perder. Fica para conferência humana, não para nova tentativa cega.
    expect(m.links.size).toBe(1);

    m.lancarDespesa.mockClear();
    m.lancarDespesa.mockResolvedValue({ data: { id_movimento_mov: "67637" }, msg: "" });
    await syncSuperlogicaVendas();
    expect(m.lancarDespesa).not.toHaveBeenCalled();
  });

  it("negócio marcado como perdido no meio do caminho NÃO é ressuscitado", async () => {
    m.venda.current = liquidada();
    m.prisma.deal.findUnique.mockResolvedValueOnce({
      pipelineId: "pipe-1",
      stage: { name: "Negócio perdido" },
    });

    const report = await syncSuperlogicaVendas();

    expect(m.moveDealStage).not.toHaveBeenCalled();
    expect(report.outcomes[0].movedToStage).toBeNull();
  });

  it("venda não devolvida pela consulta: fica pendente, sem marcar erro", async () => {
    m.venda.current = null;

    const report = await syncSuperlogicaVendas();

    expect(report.outcomes[0].result).toBe("pendente");
    expect(report.canceladas).toBe(0);
    const updates = m.prisma.superlogicaExport.update.mock.calls.map(
      (c) => (c[0] as { data: { status?: string } }).data.status,
    );
    expect(updates).not.toContain("error");
  });

  it("resultado sem mudança ainda gira a fila (updatedAt) — senão as outras vendas nunca são vistas", async () => {
    m.venda.current = venda();

    await syncSuperlogicaVendas();

    const touched = m.prisma.superlogicaExport.update.mock.calls.some(
      (c) => (c[0] as { data: { updatedAt?: Date } }).data.updatedAt instanceof Date,
    );
    expect(touched).toBe(true);
  });
});
