import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/locacao/route-helpers", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/locacao/route-helpers")>();
  return { ...orig, ensureLocacaoAccess: vi.fn() };
});
vi.mock("@/lib/deals/route-helpers", () => ({ guardDealScope: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/fichacerta/account", () => ({ isFichaCertaConfigured: vi.fn().mockResolvedValue(true) }));

import { GET } from "../route";
import { ensureLocacaoAccess } from "@/lib/locacao/route-helpers";
import { guardDealScope } from "@/lib/deals/route-helpers";

const mockEnsure = vi.mocked(ensureLocacaoAccess);
const dealFindUnique = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;
const reqFindMany = prisma.creditAnalysisRequest.findMany as unknown as ReturnType<typeof vi.fn>;

const req = new NextRequest("http://localhost/api/deals/d1/credit-analysis");
const params = { params: { dealId: "d1" } };
const DEAL = {
  id: "d1",
  kind: "locacao",
  complianceJson: { creditConsent: { at: "2026-09-05T00:00:00Z", by: "u1", baseLegal: "protecao_credito", provider: "fichacerta" } },
  pipeline: { orgId: "org1" },
  fromProposal: { id: "p1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsure.mockResolvedValue({ userId: "u1", orgId: "org1", permissions: {} } as never);
  vi.mocked(guardDealScope).mockResolvedValue(null);
  dealFindUnique.mockResolvedValue(DEAL);
  reqFindMany.mockResolvedValue([]);
});

describe("GET /api/deals/[dealId]/credit-analysis", () => {
  it("gate de módulo/permissão: o erro do ensureLocacaoAccess sai como está (feature locacao.credito)", async () => {
    mockEnsure.mockResolvedValue(NextResponse.json({ error: "MODULE_DISABLED" }, { status: 403 }) as never);
    const res = await GET(req, params);
    expect(res.status).toBe(403);
    expect(mockEnsure.mock.calls[0][1]).toBe("locacao.credito");
    expect(dealFindUnique).not.toHaveBeenCalled();
  });

  it("deal de outra org, de venda ou inexistente → 404 (mesma resposta, sem vazar existência)", async () => {
    dealFindUnique.mockResolvedValue({ ...DEAL, pipeline: { orgId: "org2" } });
    expect((await GET(req, params)).status).toBe(404);
    dealFindUnique.mockResolvedValue({ ...DEAL, kind: "venda" });
    expect((await GET(req, params)).status).toBe(404);
    dealFindUnique.mockResolvedValue(null);
    expect((await GET(req, params)).status).toBe(404);
    expect(reqFindMany).not.toHaveBeenCalled();
  });

  it("escopo do corretor (guardDealScope) barra antes de ler os requests", async () => {
    vi.mocked(guardDealScope).mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await GET(req, params)).status).toBe(403);
    expect(reqFindMany).not.toHaveBeenCalled();
  });

  it("devolve consent canônico, proposta de origem e requests projetados pelo DEAL (reportDealAttachmentId, sem resultData cru)", async () => {
    reqFindMany.mockResolvedValue([
      {
        id: "req1", status: "completed", externalId: "220", createdAt: new Date(), submittedAt: new Date(), completedAt: new Date(), lastSyncedAt: null, errorMessage: null, costCents: 1500,
        reportProposalAttachmentId: "pa1", reportDealAttachmentId: "da1",
        // parecer REAL da Ficha Certa: `sintese` por pessoa (CPF/nome) não pode sair
        resultJson: { sintese: [{ cpf: "52998224725", nome: "Maria da Silva", pretendente_id: 572 }], locacao: { parecer_inquilinos: { parecer: "APROVADO", aprovados: [{ cpf: "52998224725" }] } } },
        jobs: [{ id: "j1", label: "Análise de crédito (Ficha Certa) — Locatário", targetKind: "locatario", targetIndex: 0, status: "success", errorMessage: null, expectedReadyAt: null, createdAt: new Date(), resultData: { situacao: "sem_restricao", detalhes: "Score FC 850", raw: { scoreFc: 850, parecer: "RISCO BAIXO", recomendacoes: [], cpf: "52998224725" }, pretendente_id: 572 } }],
      },
    ]);
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(reqFindMany.mock.calls[0][0].where).toEqual({ dealId: "d1", provider: "fichacerta" });
    expect(body).toMatchObject({ configured: true, originProposalId: "p1", consent: { provider: "fichacerta" } });
    expect(body.requests[0].reportAttachmentId).toBe("da1");
    expect(body.requests[0].jobs[0]).toMatchObject({ situacao: "sem_restricao", scoreFc: 850, parecer: "RISCO BAIXO" });
    expect(body.requests[0].jobs[0]).not.toHaveProperty("resultData");
    expect(body.requests[0].parecer).toEqual({ locacao: { parecer_inquilinos: { parecer: "APROVADO" } } });
    const s = JSON.stringify(body);
    expect(s).not.toContain("52998224725");
    expect(s).not.toContain("Maria");
    expect(s).not.toContain("sintese");
  });
});
