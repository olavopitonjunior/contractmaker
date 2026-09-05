import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/certidoes/proposal-subject", () => ({
  loadProposalCertidoesScope: vi.fn(),
}));
vi.mock("@/lib/certidoes/proposal-dispatch", () => ({
  dispatchProposalCertidoes: vi.fn(),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { GET, POST } from "../route";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";
import { dispatchProposalCertidoes } from "@/lib/certidoes/proposal-dispatch";
import { prisma } from "@/lib/db/prisma";

const mockScope = vi.mocked(loadProposalCertidoesScope);
const mockDispatch = vi.mocked(dispatchProposalCertidoes);
const jobFindMany = prisma.certidaoJob.findMany as unknown as ReturnType<typeof vi.fn>;
const attFindMany = prisma.proposalAttachment.findMany as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;

const SCOPE = {
  proposal: { id: "p1", kind: "locacao", status: "enviada", title: "T" },
  orgId: "org1",
  userId: "u1",
  userEmail: "op@x.com",
  esteira: "locacao",
  dataJson: { locatarios: [{ nome: "Maria" }] },
};
const get = (qs = "") => new NextRequest(`http://localhost/api/proposals/p1/certidoes${qs}`);
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/proposals/p1/certidoes", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: { id: "p1" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockScope.mockResolvedValue({ scope: SCOPE } as never);
  jobFindMany.mockResolvedValue([]);
  attFindMany.mockResolvedValue([]);
  eventCreate.mockResolvedValue({});
});

describe("GET /api/proposals/[id]/certidoes", () => {
  it("escopo negado (feature OFF / fora do escopo) → devolve o fail do helper", async () => {
    mockScope.mockResolvedValue({ fail: NextResponse.json({ error: "MODULE_DISABLED" }, { status: 403 }) } as never);
    expect((await GET(get(), params)).status).toBe(403);
    expect(jobFindMany).not.toHaveBeenCalled();
  });

  it("lista jobs da PROPOSTA e projeta o PDF (ProposalAttachment por certidaoJobId) como `attachment`", async () => {
    jobFindMany.mockResolvedValue([
      { id: "j1", batchId: "b1", status: "success", attachmentId: null, endpoint: "tribunais/cndt" },
      { id: "j2", batchId: "b1", status: "skipped", attachmentId: null, endpoint: "receita-federal/pgfn" },
    ]);
    attFindMany.mockResolvedValue([{ id: "pa-1", filename: "cndt.pdf", mime: "application/pdf", certidaoJobId: "j1" }]);
    const res = await GET(get("?batchId=b1"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(jobFindMany.mock.calls[0][0].where).toEqual({ proposalId: "p1", batchId: "b1" });
    expect(body.latestBatchId).toBe("b1");
    expect(body.jobs[0]).toMatchObject({ id: "j1", attachmentId: "pa-1", attachment: { id: "pa-1", filename: "cndt.pdf" } });
    expect(body.jobs[1]).toMatchObject({ id: "j2", attachmentId: null, attachment: null });
  });
});

describe("POST /api/proposals/[id]/certidoes", () => {
  it("escopo de escrita negado (sem PROPOSAL_SEND / proposta convertida) → fail do helper, sem dispatch", async () => {
    mockScope.mockResolvedValue({ fail: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as never);
    expect((await POST(post({ batchId: "batch-0001" }), params)).status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockScope.mock.calls[0][2]).toEqual({ write: true });
  });

  it("body inválido (batchId curto, kind fora do enum) → 400", async () => {
    expect((await POST(post({ batchId: "x" }), params)).status).toBe(400);
    expect((await POST(post({ batchId: "batch-0001", jobs: [{ endpoint: "a", targetKind: "alien", targetIndex: 0 }] }), params)).status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("dispatch recusado (402/409) → repassa status e corpo", async () => {
    mockDispatch.mockResolvedValue({ ok: false, status: 402, body: { error: "budget" } });
    const res = await POST(post({ batchId: "batch-0001" }), params);
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("budget");
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("dispatch ok → 202, evento certidoes_dispatched e chamada com o escopo da proposta", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    mockDispatch.mockResolvedValue({ ok: true, status: 202, body: { batchId: "batch-0001", jobCount: 2, totalCostCents: 600 }, run });
    const res = await POST(post({ batchId: "batch-0001", jobs: [{ endpoint: "tribunais/cndt", targetKind: "locatario", targetIndex: 0 }] }), params);
    expect(res.status).toBe(202);
    // O lote roda sob waitUntil (Lambda viva até terminar) — não fire-and-forget na lib.
    const { waitUntil } = await import("@vercel/functions");
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.mocked(waitUntil)).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", orgId: "org1", userId: "u1", esteira: "locacao", batchId: "batch-0001" })
    );
    expect(eventCreate.mock.calls[0][0].data).toMatchObject({ eventName: "certidoes_dispatched", payload: { batchId: "batch-0001", jobCount: 2 } });
  });
});
