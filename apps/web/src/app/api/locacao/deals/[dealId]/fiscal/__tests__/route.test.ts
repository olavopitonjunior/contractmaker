import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureLocacaoAccess } from "@/lib/locacao/route-helpers";
import { mergeSalesFormDataJson } from "@/lib/forms/atomic-merge";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";

// Só o seam de auth é trocado — `isRouteError`/`parseJsonBody` (Zod) continuam
// reais, senão o teste não cobriria a validação do body.
vi.mock("@/lib/locacao/route-helpers", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/locacao/route-helpers")>();
  return { ...orig, ensureLocacaoAccess: vi.fn() };
});
// O merge atômico real depende de `SELECT ... FOR UPDATE`; aqui usamos o
// deep-merge de verdade sobre um dataJson em memória para provar o ESCOPO.
vi.mock("@/lib/forms/atomic-merge", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/forms/atomic-merge")>();
  return { ...orig, mergeSalesFormDataJson: vi.fn() };
});
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const mockEnsure = vi.mocked(ensureLocacaoAccess);
const mockMerge = vi.mocked(mergeSalesFormDataJson);

let PATCH: typeof import("../route").PATCH;

/** dataJson do form antes do PATCH — o merge escopado não pode tocar nisto. */
const CURRENT_FORM_DATA = {
  locadores: [{ nome: "Maria" }],
  comissao: { taxa_locacao_percent: 50, angariadores: [{ nome: "João" }] },
  fiscal: { taxa_admin_percent: 10, repasse_garantido: "todo_contrato" },
};

const VALID_BODY = {
  taxa_admin_percent: 8,
  regime_ir: "retem_imobiliaria",
  regime_cobranca: "mes_vencido",
  emitir_nfse: true,
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/locacao/deals/d1/fiscal", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  ({ PATCH } = await import("../route"));

  mockEnsure.mockResolvedValue({
    userId: "u1",
    orgId: "org-1",
    permissions: {},
  } as never);

  p.deal.findUnique = vi.fn().mockResolvedValue({
    id: "d1",
    kind: "locacao",
    formId: "form-1",
    pipeline: { orgId: "org-1" },
  });
  // O model LeaseContract não está no mock global do Prisma (setup.ts).
  p.leaseContract = {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  };

  mockMerge.mockImplementation(async (args) => {
    const finalData = deepMergeAtPaths(
      structuredClone(CURRENT_FORM_DATA) as Record<string, unknown>,
      args.incoming,
      args.allowedTopKeys
    ).merged;
    return {
      merged: finalData,
      rejectedPaths: [],
      skippedBlankArrayKeys: [],
      updated: { id: "form-1", status: "completo", updatedAt: new Date(), completedAt: null },
      finalData,
    };
  });
});

describe("PATCH /api/locacao/deals/[dealId]/fiscal", () => {
  it("grava o bloco fiscal com merge escopado (não toca comissão/partes)", async () => {
    const res = await PATCH(req(VALID_BODY), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);

    const call = mockMerge.mock.calls[0][0];
    expect(call.where).toEqual({ id: "form-1" });
    expect(call.allowedTopKeys).toEqual(["fiscal"]);
    expect(Object.keys(call.incoming)).toEqual(["fiscal"]);

    const body = await res.json();
    expect(body.dealId).toBe("d1");
    expect(body.fiscal).toMatchObject({
      taxa_admin_percent: 8,
      regime_ir: "retem_imobiliaria",
      regime_cobranca: "mes_vencido",
      emitir_nfse: true,
      // Chave fiscal que o diálogo não coleta sobrevive ao merge.
      repasse_garantido: "todo_contrato",
    });
  });

  it("espelha colunas E dataJson no LeaseContract quando ele já existe", async () => {
    p.leaseContract.findFirst.mockResolvedValue({
      id: "lease-1",
      dataJson: { fiscal: { taxa_admin_percent: 10 }, comissao: { taxa_locacao_percent: 50 } },
    });

    const res = await PATCH(req(VALID_BODY), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);

    expect(p.leaseContract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dealId: "d1", orgId: "org-1" } })
    );
    const update = p.leaseContract.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "lease-1" });
    expect(update.data).toMatchObject({
      taxaAdminPercent: 8,
      regimeIr: "retem_imobiliaria",
      regimeCobranca: "mes_vencido",
      emitirNfse: true,
    });
    expect(update.data.dataJson).toMatchObject({
      fiscal: { taxa_admin_percent: 8, emitir_nfse: true },
      comissao: { taxa_locacao_percent: 50 },
    });
  });

  it("sem LeaseContract ainda: grava só no form, sem update", async () => {
    const res = await PATCH(req(VALID_BODY), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);
    expect(p.leaseContract.update).not.toHaveBeenCalled();
  });

  it("aplica os defaults da casa quando o body vem vazio", async () => {
    const res = await PATCH(req({}), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fiscal).toMatchObject({
      taxa_admin_percent: 10,
      regime_ir: "nao_retem",
      regime_cobranca: "mes_a_vencer",
      emitir_nfse: false,
    });
  });

  it("422 em taxa fora de 0-100 ou regime desconhecido", async () => {
    const overTaxa = await PATCH(req({ taxa_admin_percent: 101 }), {
      params: { dealId: "d1" },
    });
    expect(overTaxa.status).toBe(422);
    const badRegime = await PATCH(req({ regime_ir: "retem_talvez" }), {
      params: { dealId: "d1" },
    });
    expect(badRegime.status).toBe(422);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it("deal de outra org → 403 e nada é gravado (cross-org)", async () => {
    p.deal.findUnique.mockResolvedValue({
      id: "d1",
      kind: "locacao",
      formId: "form-1",
      pipeline: { orgId: "org-999" },
    });
    const res = await PATCH(req(VALID_BODY), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
    expect(mockMerge).not.toHaveBeenCalled();
    expect(p.leaseContract.update).not.toHaveBeenCalled();
  });

  it("deal de VENDA (kind errado) → 404", async () => {
    p.deal.findUnique.mockResolvedValue({
      id: "d1",
      kind: "venda",
      formId: "form-1",
      pipeline: { orgId: "org-1" },
    });
    const res = await PATCH(req(VALID_BODY), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it("deal sem formulário → 409", async () => {
    p.deal.findUnique.mockResolvedValue({
      id: "d1",
      kind: "locacao",
      formId: null,
      pipeline: { orgId: "org-1" },
    });
    const res = await PATCH(req(VALID_BODY), { params: { dealId: "d1" } });
    expect(res.status).toBe(409);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it("repassa a resposta de erro do seam de auth (403 módulo desabilitado)", async () => {
    const { NextResponse } = await import("next/server");
    mockEnsure.mockResolvedValue(
      NextResponse.json({ error: "MODULE_DISABLED" }, { status: 403 }) as never
    );
    const res = await PATCH(req(VALID_BODY), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
    expect(p.deal.findUnique).not.toHaveBeenCalled();
  });
});
