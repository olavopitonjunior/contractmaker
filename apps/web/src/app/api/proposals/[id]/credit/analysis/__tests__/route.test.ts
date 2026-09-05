import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
  proposalFeatureGuard: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/security/rbac/check", () => ({ can: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/modules/read", () => ({
  getOrgModules: vi.fn().mockResolvedValue({}),
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/fichacerta/account", () => ({ getOrgFichaCertaCreds: vi.fn() }));
vi.mock("@/lib/fichacerta/client", () => ({ getCredits: vi.fn().mockResolvedValue(10) }));
vi.mock("@/lib/credit/fichacerta-runner", () => ({ submitCreditRequest: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined), extractAuditContextFromRequest: vi.fn(() => ({})) }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn((p: Promise<unknown>) => p) }));
vi.mock("@/lib/security/budget-lock", () => ({
  withOrgBudgetLock: vi.fn(async (_ns: string, _org: string, fn: (tx: unknown) => Promise<unknown>) => {
    const { prisma } = await import("@/lib/db/prisma");
    return fn(prisma);
  }),
}));

import { GET, POST } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { isFeatureEnabled } from "@/lib/modules/read";
import { getOrgFichaCertaCreds } from "@/lib/fichacerta/account";
import { getCredits } from "@/lib/fichacerta/client";
import { submitCreditRequest } from "@/lib/credit/fichacerta-runner";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const attFindMany = prisma.proposalAttachment.findMany as unknown as ReturnType<typeof vi.fn>;
const jobFindMany = prisma.certidaoJob.findMany as unknown as ReturnType<typeof vi.fn>;
const jobAggregate = prisma.certidaoJob.aggregate as unknown as ReturnType<typeof vi.fn>;
const jobCreate = prisma.certidaoJob.create as unknown as ReturnType<typeof vi.fn>;
const reqCreate = prisma.creditAnalysisRequest.create as unknown as ReturnType<typeof vi.fn>;
const reqFindMany = prisma.creditAnalysisRequest.findMany as unknown as ReturnType<typeof vi.fn>;
const tx = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;

const CREDS = { orgId: "org1", login: "l", password: "p", baseUrl: "https://stage", products: [1, 9], costCents: 1500 };
const CONSENT = { creditConsent: { at: "2026-09-05T00:00:00Z", by: "u1", baseLegal: "protecao_credito", provider: "fichacerta" } };
const DATA_OK = { locatarios: [{ nome: "Maria", cpf: "52998224725", data_nascimento: "1990-05-10", renda_mensal: 3500, renda_origem: 11 }], locacao: { valor_aluguel: 3200 }, imovel: { rua: "Rua A" } };

function load(over: Partial<{ status: string; kind: string; dataJson: unknown; complianceJson: unknown }> = {}) {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org1" }, actor: { effectiveUserId: "u1" } },
    eff: {},
    proposal: { id: "p1", code: "PROP-1", kind: "locacao", status: "enviada", schemaType: "locacao_residencial_v1", dataJson: DATA_OK, complianceJson: CONSENT, ...over },
  } as never);
}
const post = (body: unknown = {}) =>
  new NextRequest("http://localhost/api/proposals/p1/credit/analysis", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = { params: { id: "p1" } };

beforeEach(() => {
  vi.clearAllMocks();
  load();
  vi.mocked(isFeatureEnabled).mockReturnValue(true);
  vi.mocked(getOrgFichaCertaCreds).mockResolvedValue(CREDS as never);
  vi.mocked(getCredits).mockResolvedValue(10);
  attFindMany.mockResolvedValue([]);
  jobFindMany.mockResolvedValue([]);
  jobAggregate.mockResolvedValue({ _sum: { costCents: 0 } });
  jobCreate.mockResolvedValue({ id: "j1" });
  reqCreate.mockResolvedValue({ id: "req1" });
  reqFindMany.mockResolvedValue([]);
  tx.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(prisma));
  eventCreate.mockResolvedValue({});
});

describe("POST /api/proposals/[id]/credit/analysis — gates, na ordem", () => {
  it("feature desligada / venda → 403", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
    expect((await POST(post(), params)).status).toBe(403);
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    load({ kind: "venda" });
    expect((await POST(post(), params)).status).toBe(403);
  });
  it("proposta convertida → 409; completa → passa", async () => {
    load({ status: "convertida" });
    expect((await POST(post(), params)).status).toBe(409);
    load({ status: "completa" });
    expect((await POST(post(), params)).status).toBe(202);
  });
  it("conta não conectada → 503 notConfigured", async () => {
    vi.mocked(getOrgFichaCertaCreds).mockResolvedValue(null);
    const res = await POST(post(), params);
    expect(res.status).toBe(503);
    expect((await res.json()).notConfigured).toBe(true);
  });
  it("sem consentimento → 412 requiresConsent (legado serasaConsent conta)", async () => {
    load({ complianceJson: null });
    const res = await POST(post(), params);
    expect(res.status).toBe(412);
    expect((await res.json()).requiresConsent).toBe(true);
    load({ complianceJson: { serasaConsent: { at: "2026-01-01T00:00:00Z", by: "x", baseLegal: "protecao_credito" } } });
    expect((await POST(post(), params)).status).toBe(202);
  });
  it("pretendente incompleto → 422 com o que falta; sem pretendentes → 422", async () => {
    load({ dataJson: { locatarios: [{ nome: "Maria" }] } });
    const res = await POST(post(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).missing[0]).toMatchObject({ kind: "locatario", missing: ["cpf", "data_nascimento"] });
    load({ dataJson: {} });
    expect((await POST(post(), params)).status).toBe(422);
  });
  it("laudo já em andamento para o alvo → 409", async () => {
    jobFindMany.mockResolvedValue([{ targetKind: "locatario", targetIndex: 0, status: "awaiting_portal", createdAt: new Date(), resultData: { numero_pedido: "220" }, retryCount: 0, maxRetries: 3 }]);
    expect((await POST(post(), params)).status).toBe(409);
  });
  it("teto mensal → 402 auditado; créditos insuficientes → 402; API fora → 502", async () => {
    jobAggregate.mockResolvedValue({ _sum: { costCents: 300_000 } });
    expect((await POST(post(), params)).status).toBe(402);
    jobAggregate.mockResolvedValue({ _sum: { costCents: 0 } });
    vi.mocked(getCredits).mockResolvedValue(0);
    expect((await POST(post(), params)).status).toBe(402);
    vi.mocked(getCredits).mockRejectedValue(new Error("down"));
    expect((await POST(post(), params)).status).toBe(502);
    expect(reqCreate).not.toHaveBeenCalled();
  });
});

describe("POST — disparo", () => {
  it("cria request pending + 1 job por pretendente (label SEM nome, payload da Ficha Certa) e envia sob waitUntil", async () => {
    const res = await POST(post(), params);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ requestId: "req1", jobCount: 1, totalCostCents: 1500 });
    const reqData = reqCreate.mock.calls[0][0].data;
    expect(reqData).toMatchObject({ orgId: "org1", proposalId: "p1", provider: "fichacerta", status: "pending" });
    expect(reqData.requestJson.locacao).toMatchObject({ tipo_imovel: "RESIDENCIAL", aluguel: "3200.00", codigo_imovel: "PROP-1" });
    const job = jobCreate.mock.calls[0][0].data;
    expect(job).toMatchObject({ proposalId: "p1", orgId: "org1", provider: "fichacerta", creditRequestId: "req1", endpoint: "fichacerta/laudo-pf", targetKind: "locatario", targetIndex: 0, status: "pending" });
    expect(job.label).toBe("Análise de crédito (Ficha Certa) — Locatário");
    expect(job.label).not.toContain("Maria");
    expect(job.requestPayload).toMatchObject({ tipo_pretendente: "INQUILINO", cpf: "52998224725", data_nascimento: "1990-05-10", residir: true });
    expect(submitCreditRequest).toHaveBeenCalledWith("req1");
    expect(eventCreate.mock.calls[0][0].data.eventName).toBe("credit_analysis_dispatched");
    // trava por alvo, teto e criação rodam sob o advisory lock da org
    const { withOrgBudgetLock } = await import("@/lib/security/budget-lock");
    expect(vi.mocked(withOrgBudgetLock).mock.calls[0][0]).toBe("fichacerta");
    expect(vi.mocked(withOrgBudgetLock).mock.calls[0][1]).toBe("org1");
  });
});

describe("GET", () => {
  it("devolve configured/consent e as requests com jobs projetados (sem resultData cru)", async () => {
    reqFindMany.mockResolvedValue([
      {
        id: "req1", status: "completed", externalId: "220", createdAt: new Date(), submittedAt: new Date(), completedAt: new Date(), lastSyncedAt: null, errorMessage: null, costCents: 1500, reportProposalAttachmentId: "pa1", resultJson: { locacao: { parecer_inquilinos: { parecer: "APROVADO" } } },
        jobs: [{ id: "j1", label: "L", targetKind: "locatario", targetIndex: 0, status: "success", errorMessage: null, expectedReadyAt: null, createdAt: new Date(), resultData: { situacao: "sem_restricao", detalhes: "Score FC 850", raw: { scoreFc: 850, parecer: "RISCO BAIXO", recomendacoes: ["ok"], icons: { x: "positivo" } }, pretendente_id: 572 } }],
      },
    ]);
    const res = await GET(new NextRequest("http://localhost/api/proposals/p1/credit/analysis"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.consent).toMatchObject({ provider: "fichacerta" });
    expect(body.requests[0]).toMatchObject({ reportAttachmentId: "pa1", parecer: { locacao: { parecer_inquilinos: { parecer: "APROVADO" } } } });
    expect(body.requests[0].jobs[0]).toMatchObject({ situacao: "sem_restricao", scoreFc: 850, parecer: "RISCO BAIXO", recomendacoes: ["ok"] });
    expect(body.requests[0].jobs[0]).not.toHaveProperty("resultData");
  });
});
