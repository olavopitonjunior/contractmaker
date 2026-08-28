import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

const requireApiAuthMock = vi.fn();
vi.mock("@/lib/api/require-auth", () => ({
  requireApiAuth: (...args: unknown[]) => requireApiAuthMock(...args),
  isAuthFailure: (r: unknown) => (r as { ok?: boolean })?.ok === false,
  authFailureResponse: () => new Response("unauthorized", { status: 401 }),
}));

const guardContractScopeMock = vi.fn();
vi.mock("@/lib/deals/route-helpers", () => ({
  guardContractScope: (...args: unknown[]) => guardContractScopeMock(...args),
}));

vi.mock("@/lib/contract-review/guard", () => ({
  isContractReviewEnabled: vi.fn(async () => true),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { isContractReviewEnabled } from "@/lib/contract-review/guard";
import { GET, POST } from "../route";

const CONTRACT_ID = "c1";
const contractFindUnique = prisma.contract.findUnique as ReturnType<typeof vi.fn>;
const runFindFirst = prisma.contractReviewRun.findFirst as ReturnType<typeof vi.fn>;
const runCreate = prisma.contractReviewRun.create as ReturnType<typeof vi.fn>;

function req(method: "GET" | "POST") {
  return new NextRequest(`http://localhost/api/contracts/${CONTRACT_ID}/review`, {
    method,
  });
}

function authOk() {
  requireApiAuthMock.mockResolvedValue({
    ok: true,
    org: { id: "org-1" },
    actor: { effectiveUserId: "u1" },
    ident: { via: "session" },
  });
}

function mockContract(overrides: Record<string, unknown> = {}) {
  contractFindUnique.mockResolvedValue({
    id: CONTRACT_ID,
    status: "rascunho",
    deal: { kind: "locacao", pipeline: { orgId: "org-1" } },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authOk();
  guardContractScopeMock.mockResolvedValue(null);
  runFindFirst.mockResolvedValue(null);
  runCreate.mockResolvedValue({ id: "run-novo" });
  (isContractReviewEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  process.env.CRON_SECRET = "segredo";
});

describe("POST /api/contracts/[id]/review", () => {
  it("cria run novo e devolve runId", async () => {
    mockContract();
    const res = await POST(req("POST"), { params: { id: CONTRACT_ID } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: "run-novo", reused: false });
    expect(runCreate).toHaveBeenCalledWith({
      data: { contractId: CONTRACT_ID, orgId: "org-1" },
      select: { id: true },
    });
  });

  it("contrato de outra org → 404 idêntico a inexistente", async () => {
    mockContract({ deal: { kind: "locacao", pipeline: { orgId: "org-2" } } });
    const res = await POST(req("POST"), { params: { id: CONTRACT_ID } });
    expect(res.status).toBe(404);
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("contrato aprovado → 409 (imutável)", async () => {
    mockContract({ status: "aprovado" });
    const res = await POST(req("POST"), { params: { id: CONTRACT_ID } });
    expect(res.status).toBe(409);
  });

  it("flag desligada → 403", async () => {
    mockContract();
    (isContractReviewEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(req("POST"), { params: { id: CONTRACT_ID } });
    expect(res.status).toBe(403);
  });

  it("run vivo na fila é reusado — clique duplo não cria segundo run", async () => {
    mockContract();
    runFindFirst.mockResolvedValue({ id: "run-vivo", status: "queued", startedAt: null });
    const res = await POST(req("POST"), { params: { id: CONTRACT_ID } });
    expect(await res.json()).toEqual({ runId: "run-vivo", reused: true });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("run reviewing STALE não bloqueia — cria novo", async () => {
    mockContract();
    runFindFirst.mockResolvedValue({
      id: "run-morto",
      status: "reviewing",
      startedAt: new Date(Date.now() - 20 * 60_000),
    });
    const res = await POST(req("POST"), { params: { id: CONTRACT_ID } });
    expect(await res.json()).toEqual({ runId: "run-novo", reused: false });
  });
});

describe("GET /api/contracts/[id]/review", () => {
  it("devolve o run mais recente", async () => {
    mockContract();
    runFindFirst.mockResolvedValue({
      id: "r1",
      status: "done",
      error: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await GET(req("GET"), { params: { id: CONTRACT_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe("r1");
    expect(body.run.status).toBe("done");
  });

  it("sem run → run null", async () => {
    mockContract();
    const res = await GET(req("GET"), { params: { id: CONTRACT_ID } });
    expect((await res.json()).run).toBeNull();
  });
});
