import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { FEATURE } from "@/lib/modules/catalog";

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

const executeMock = vi.fn();
vi.mock("@/lib/ingestion/plan-executor", () => ({
  executePlanSlice: (...args: unknown[]) => executeMock(...args),
}));

const chainExecuteMock = vi.fn(async () => ({ scheduled: true }));
vi.mock("@/lib/ingestion/chain", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ingestion/chain")>(
    "@/lib/ingestion/chain"
  );
  return { ...actual, chainExecute: (...args: unknown[]) => chainExecuteMock(...args) };
});

const getOrgModulesMock = vi.fn();
vi.mock("@/lib/modules/read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/modules/read")>(
    "@/lib/modules/read"
  );
  return { ...actual, getOrgModules: (...args: unknown[]) => getOrgModulesMock(...args) };
});

import { POST } from "../runs/[id]/execute/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const runFindFirst = prisma.ingestionRun.findFirst as unknown as ReturnType<typeof vi.fn>;
const runUpdateMany = prisma.ingestionRun.updateMany as unknown as ReturnType<
  typeof vi.fn
>;

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const params = { params: { id: "run-1" } };

const DECISIONS = {
  templates: [{ sourceItemId: "item-0", approved: true }],
  clauses: [{ sourceItemId: "item-0", tags: ["slot:garantia"], approved: false }],
  discards: [{ itemId: "item-1", approved: true }],
};

function req(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/templates/ingest/runs/run-1/execute", {
    method: "POST",
    headers: body ? { "content-type": "application/json", ...headers } : headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "segredo";
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  getUserOrgMock.mockResolvedValue({ id: "org-1" });
  membershipFindFirst.mockResolvedValue({ role: "owner" });
  getOrgModulesMock.mockResolvedValue({
    enabled: { vendas: false, locacao: true },
    features: {
      [FEATURE.LOCACAO_INGESTAO_ACERVO]: true,
      [FEATURE.VENDAS_INGESTAO_ACERVO]: false,
    },
  });
  runUpdateMany.mockResolvedValue({ count: 1 });
  executeMock.mockResolvedValue({
    runId: "run-1",
    claimed: true,
    status: "executing",
    processed: 1,
    templatesCreated: 0,
    clausesCreated: 1,
    hasMore: true,
    report: null,
  });
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("POST /runs/:id/execute — aprovação", () => {
  it("grava a revisão e leva o run de awaiting_review a executing", async () => {
    await POST(req(DECISIONS) as never, params);

    const call = runUpdateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: "run-1",
      orgId: "org-1",
      status: "awaiting_review",
    });
    expect(call.data.status).toBe("executing");
    expect(call.data.planReviewed.templates).toEqual(DECISIONS.templates);
    // O que foi recusado NÃO some do plano revisado.
    expect(call.data.planReviewed.clauses[0].approved).toBe(false);
  });

  it("quem aprovou é carimbado pelo servidor, não pelo cliente", async () => {
    await POST(
      req({ ...DECISIONS, reviewedBy: "invasor", reviewedAt: "1999-01-01" }) as never,
      params
    );

    const { planReviewed } = runUpdateMany.mock.calls[0][0].data;
    expect(planReviewed.reviewedBy).toBe("user-1");
    expect(new Date(planReviewed.reviewedAt).getFullYear()).toBeGreaterThan(2020);
  });

  it("payload inválido é 400 e não toca no run", async () => {
    const res = await POST(req({ templates: [{ approved: "talvez" }] }) as never, params);
    expect(res.status).toBe(400);
    expect(runUpdateMany).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("run já concluído devolve 409 — não reaplica o plano", async () => {
    runUpdateMany.mockResolvedValue({ count: 0 });
    runFindFirst.mockResolvedValue({ status: "done" });

    const res = await POST(req(DECISIONS) as never, params);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("RUN_NOT_REVIEWABLE");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("run já executando segue como continuação (dois cliques não duplicam)", async () => {
    runUpdateMany.mockResolvedValue({ count: 0 });
    runFindFirst.mockResolvedValue({ status: "executing" });

    const res = await POST(req(DECISIONS) as never, params);

    expect(res.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith({ runId: "run-1", orgId: "org-1" });
  });
});

describe("POST /runs/:id/execute — portas de entrada", () => {
  it("a sessão escopa o run pelo orgId", async () => {
    await POST(req(DECISIONS) as never, params);
    expect(executeMock).toHaveBeenCalledWith({ runId: "run-1", orgId: "org-1" });
  });

  it("a chamada interna continua a fatia sem sessão e sem corpo", async () => {
    await POST(req(undefined, { "x-cron-secret": "segredo" }) as never, params);

    expect(executeMock).toHaveBeenCalledWith({ runId: "run-1", orgId: undefined });
    expect(authMock).not.toHaveBeenCalled();
    // A corrente nunca reescreve a decisão do operador.
    expect(runUpdateMany).not.toHaveBeenCalled();
  });

  it("401 sem sessão e sem segredo", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req(DECISIONS) as never, params);
    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("403 para quem não é owner/admin", async () => {
    membershipFindFirst.mockResolvedValue({ role: "corretor" });
    const res = await POST(req(DECISIONS) as never, params);
    expect(res.status).toBe(403);
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("POST /runs/:id/execute — escopo e re-encadeamento", () => {
  it("run inexistente e run de outra imobiliária dão o MESMO 404", async () => {
    runUpdateMany.mockResolvedValue({ count: 0 });
    runFindFirst.mockResolvedValue(null);

    const res = await POST(req(DECISIONS) as never, params);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Lote não encontrado" });
    expect(runFindFirst.mock.calls[0][0].where).toEqual({
      id: "run-1",
      orgId: "org-1",
    });
  });

  it("dispara a próxima fatia quando sobrou template", async () => {
    await POST(req(DECISIONS) as never, params);
    expect(chainExecuteMock).toHaveBeenCalledWith("http://localhost", "run-1");
  });

  it("não re-encadeia quando o run terminou", async () => {
    executeMock.mockResolvedValue({
      runId: "run-1",
      claimed: true,
      status: "done",
      processed: 2,
      templatesCreated: 1,
      clausesCreated: 1,
      hasMore: false,
      report: null,
    });
    await POST(req(DECISIONS) as never, params);
    expect(chainExecuteMock).not.toHaveBeenCalled();
  });

  it("run ocupado responde 200 com o estado real do banco", async () => {
    executeMock.mockResolvedValue({
      runId: "run-1",
      claimed: false,
      status: null,
      processed: 0,
      templatesCreated: 0,
      clausesCreated: 0,
      hasMore: false,
      report: null,
    });
    runFindFirst.mockResolvedValue({
      status: "executing",
      itemsTotal: 4,
      itemsDone: 2,
    });

    const res = await POST(req(undefined, { "x-cron-secret": "segredo" }) as never, params);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimed).toBe(false);
    expect(body.status).toBe("executing");
    expect(chainExecuteMock).not.toHaveBeenCalled();
  });
});
