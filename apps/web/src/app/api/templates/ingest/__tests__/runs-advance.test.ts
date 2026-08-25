import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { FEATURE } from "@/lib/modules/catalog";

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

const advanceRunMock = vi.fn();
vi.mock("@/lib/ingestion/run-executor", () => ({
  advanceRun: (...args: unknown[]) => advanceRunMock(...args),
}));

const chainAdvanceMock = vi.fn(async () => ({ scheduled: true }));
vi.mock("@/lib/ingestion/chain", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ingestion/chain")>(
    "@/lib/ingestion/chain"
  );
  return { ...actual, chainAdvance: (...args: unknown[]) => chainAdvanceMock(...args) };
});

const getOrgModulesMock = vi.fn();
vi.mock("@/lib/modules/read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/modules/read")>(
    "@/lib/modules/read"
  );
  return { ...actual, getOrgModules: (...args: unknown[]) => getOrgModulesMock(...args) };
});

import { POST } from "../runs/[id]/advance/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const runFindFirst = prisma.ingestionRun.findFirst as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/templates/ingest/runs/run-1/advance", {
    method: "POST",
    headers,
  });
}

const params = { params: { id: "run-1" } };

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
  advanceRunMock.mockResolvedValue({
    runId: "run-1",
    claimed: true,
    status: "extracting",
    itemsTotal: 7,
    itemsDone: 5,
    processed: 5,
    hasMore: true,
  });
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("POST /runs/:id/advance — portas de entrada", () => {
  it("a sessão escopa o run pelo orgId", async () => {
    await POST(req() as never, params);
    expect(advanceRunMock).toHaveBeenCalledWith({ runId: "run-1", orgId: "org-1" });
  });

  it("a chamada interna passa o segredo e não usa sessão", async () => {
    await POST(req({ "x-cron-secret": "segredo" }) as never, params);
    expect(advanceRunMock).toHaveBeenCalledWith({ runId: "run-1", orgId: undefined });
    expect(authMock).not.toHaveBeenCalled();
  });

  it("segredo errado cai na sessão (e não vira porta interna)", async () => {
    await POST(req({ "x-cron-secret": "errado" }) as never, params);
    expect(advanceRunMock).toHaveBeenCalledWith({ runId: "run-1", orgId: "org-1" });
  });

  it("401 sem sessão e sem segredo", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req() as never, params);
    expect(res.status).toBe(401);
    expect(advanceRunMock).not.toHaveBeenCalled();
  });
});

describe("POST /runs/:id/advance — re-encadeamento", () => {
  it("dispara a próxima fatia quando sobrou trabalho", async () => {
    await POST(req() as never, params);
    expect(chainAdvanceMock).toHaveBeenCalledWith("http://localhost", "run-1");
  });

  it("não re-encadeia quando o run parou (planning espera o planner)", async () => {
    advanceRunMock.mockResolvedValue({
      runId: "run-1",
      claimed: true,
      status: "planning",
      itemsTotal: 3,
      itemsDone: 3,
      processed: 0,
      hasMore: false,
    });
    await POST(req() as never, params);
    expect(chainAdvanceMock).not.toHaveBeenCalled();
  });
});

describe("POST /runs/:id/advance — idempotência e escopo", () => {
  it("run ocupado responde 200 com claimed:false — não é erro, é a corrida", async () => {
    advanceRunMock.mockResolvedValue({
      runId: "run-1",
      claimed: false,
      status: null,
      itemsTotal: 0,
      itemsDone: 0,
      processed: 0,
      hasMore: false,
    });
    runFindFirst.mockResolvedValue({
      status: "extracting",
      itemsTotal: 7,
      itemsDone: 5,
    });

    const res = await POST(req() as never, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimed).toBe(false);
    // O estado real vem do banco, não do "null" do executor.
    expect(body.status).toBe("extracting");
    expect(body.itemsDone).toBe(5);
    expect(chainAdvanceMock).not.toHaveBeenCalled();
  });

  it("run inexistente e run de outra imobiliária dão o MESMO 404", async () => {
    advanceRunMock.mockResolvedValue({
      runId: "run-1",
      claimed: false,
      status: null,
      itemsTotal: 0,
      itemsDone: 0,
      processed: 0,
      hasMore: false,
    });
    runFindFirst.mockResolvedValue(null);

    const res = await POST(req() as never, params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Lote não encontrado" });
    // A releitura também é escopada — nunca confirma a existência do run alheio.
    expect(runFindFirst.mock.calls[0][0].where).toEqual({
      id: "run-1",
      orgId: "org-1",
    });
  });
});
