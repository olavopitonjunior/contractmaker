import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { FEATURE } from "@/lib/modules/catalog";
import { INGESTION_NOTES_FLAG } from "@/lib/ingestion/library-snapshot";

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

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

import { POST } from "../runs/[id]/replan/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const runFindFirst = prisma.ingestionRun.findFirst as unknown as ReturnType<typeof vi.fn>;
const runUpdateMany = prisma.ingestionRun.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const moduleFindFirst = prisma.orgModule.findFirst as unknown as ReturnType<typeof vi.fn>;
const moduleUpdate = prisma.orgModule.update as unknown as ReturnType<typeof vi.fn>;

function req(body: unknown = {}): Request {
  return new Request("http://localhost/api/templates/ingest/runs/run-1/replan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const call = (body?: unknown) =>
  POST(req(body) as never, { params: { id: "run-1" } });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  getUserOrgMock.mockResolvedValue({ id: "org-1" });
  membershipFindFirst.mockResolvedValue({ role: "owner" });
  getOrgModulesMock.mockResolvedValue({
    enabled: { vendas: false, locacao: true },
    features: { [FEATURE.LOCACAO_INGESTAO_ACERVO]: true },
  });
  runFindFirst.mockResolvedValue({
    id: "run-1",
    status: "awaiting_review",
    report: { planning: { stepsStarted: 2 }, grouping: {} },
  });
  runUpdateMany.mockResolvedValue({ count: 1 });
  moduleFindFirst.mockResolvedValue({ id: "mod-1", featureFlags: {} });
});

describe("POST /runs/[id]/replan", () => {
  it("devolve o run para planning com as escadas ZERADAS e reencadeia", async () => {
    const res = await call({ comments: ["A caução comercial é template, não cláusula."] });
    expect(res.status).toBe(200);

    const [{ data }] = runUpdateMany.mock.calls[0];
    expect(data.status).toBe("planning");
    expect(data.startedAt).toBeNull();
    expect(data.error).toBeNull();
    // Escada zerada: replanejar é pagar de novo, por decisão do operador.
    expect(data.report.planning).toBeUndefined();
    // O comentário fica no report — é de lá que o executor o injeta no prompt.
    expect(data.report.planningComments).toEqual([
      "A caução comercial é template, não cláusula.",
    ]);
    expect(chainAdvanceMock).toHaveBeenCalled();
  });

  it("run failed também é recuperável — extração e classificação já estão pagas", async () => {
    runFindFirst.mockResolvedValue({ id: "run-1", status: "failed", report: {} });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("planning");
  });

  it("recusa quando a execução já começou — o plano novo não desfaz escrita", async () => {
    runFindFirst.mockResolvedValue({
      id: "run-1",
      status: "awaiting_review",
      report: { execution: { clauses: [] } },
    });
    const res = await call();
    expect(res.status).toBe(409);
    expect(runUpdateMany).not.toHaveBeenCalled();
  });

  it("recusa estados fora da janela (executing, done, planning)", async () => {
    for (const status of ["executing", "done", "planning"]) {
      runFindFirst.mockResolvedValue({ id: "run-1", status, report: {} });
      const res = await call();
      expect(res.status).toBe(409);
    }
  });

  it("nota persistente vai para o módulo de locação com autor e data", async () => {
    moduleFindFirst.mockResolvedValue({
      id: "mod-1",
      featureFlags: {
        [INGESTION_NOTES_FLAG]: [{ text: "antiga", author: "u0", at: "2026-01-01" }],
      },
    });
    const res = await call({ notes: ["Nunca amarrar template a fornecedor."] });
    expect(res.status).toBe(200);

    const [{ data }] = moduleUpdate.mock.calls[0];
    const notes = data.featureFlags[INGESTION_NOTES_FLAG];
    expect(notes).toHaveLength(2);
    expect(notes[1].text).toBe("Nunca amarrar template a fornecedor.");
    expect(notes[1].author).toBe("user-1");
    expect((await res.json()).notesSaved).toBe(1);
  });

  it("transição atômica: outro clique chegou antes → 409, não corrida", async () => {
    runUpdateMany.mockResolvedValue({ count: 0 });
    const res = await call();
    expect(res.status).toBe(409);
    expect(chainAdvanceMock).not.toHaveBeenCalled();
  });

  it("404 para run de outra imobiliária", async () => {
    runFindFirst.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
  });
});
