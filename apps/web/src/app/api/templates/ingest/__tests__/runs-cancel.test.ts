import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * "Descartar lote". O que estes casos guardam: lote terminado não se descarta;
 * lote em processamento (claim vivo) recebe 409 em vez de ser sobrescrito; o
 * descarte marca os itens não executados e deixa linha de auditoria.
 */
const authorizeMock = vi.fn();
vi.mock("@/lib/ingestion/route-auth", () => ({
  authorizeIngestion: (...a: unknown[]) => authorizeMock(...a),
}));

const auditMock = vi.fn();
vi.mock("@/lib/security/audit", () => ({
  audit: (...a: unknown[]) => auditMock(...a),
  extractAuditContextFromRequest: (_r: unknown, orgId: string, userId: string) => ({ orgId, userId }),
}));

import { POST } from "../runs/[id]/cancel/route";

const runFindFirst = vi.fn();
const runUpdateMany = vi.fn();
const itemUpdateMany = vi.fn();
Object.assign(prisma.ingestionRun, { findFirst: runFindFirst, updateMany: runUpdateMany });
Object.assign(prisma.ingestionItem, { updateMany: itemUpdateMany });

const call = () =>
  POST(
    new Request("http://localhost/api/templates/ingest/runs/run-1/cancel", { method: "POST" }) as never,
    { params: { id: "run-1" } }
  );

beforeEach(() => {
  vi.clearAllMocks();
  authorizeMock.mockResolvedValue({ ok: true, actor: { orgId: "org-1", userId: "user-1" } });
  runFindFirst.mockResolvedValue({ id: "run-1", status: "awaiting_review" });
  runUpdateMany.mockResolvedValue({ count: 1 });
  itemUpdateMany.mockResolvedValue({ count: 3 });
});

describe("POST /api/templates/ingest/runs/[id]/cancel", () => {
  it("devolve a resposta da autorização quando ela recusa (401)", async () => {
    authorizeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await call()).status).toBe(401);
    expect(runUpdateMany).not.toHaveBeenCalled();
  });

  it("404 para lote inexistente ou de outra org (escopo na query)", async () => {
    runFindFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(runFindFirst.mock.calls[0][0].where).toMatchObject({ id: "run-1", orgId: "org-1" });
    expect(runUpdateMany).not.toHaveBeenCalled();
  });

  it("409 RUN_TERMINAL: lote concluído/falho/cancelado não se descarta", async () => {
    for (const status of ["done", "failed", "cancelled"]) {
      runFindFirst.mockResolvedValue({ id: "run-1", status });
      const res = await call();
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("RUN_TERMINAL");
    }
    expect(runUpdateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("409 RUN_BUSY: claim vivo (updateMany count 0) — nada de item, nada de audit", async () => {
    runUpdateMany.mockResolvedValue({ count: 0 });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("RUN_BUSY");
    expect(itemUpdateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("caminho feliz: a disponibilidade vai no WHERE, itens não executados viram discarded, audit", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "cancelled", itemsDiscarded: 3 });

    const where = runUpdateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "run-1", orgId: "org-1" });
    expect(where.status.notIn).toEqual(expect.arrayContaining(["done", "failed", "cancelled"]));
    expect(where.OR[0]).toEqual({ startedAt: null });
    expect(where.OR[1].startedAt.lt).toBeInstanceOf(Date);
    expect(runUpdateMany.mock.calls[0][0].data).toEqual({
      status: "cancelled",
      error: null,
      startedAt: null,
    });

    expect(itemUpdateMany.mock.calls[0][0]).toEqual({
      where: { runId: "run-1", status: { notIn: ["executed", "discarded"] } },
      data: { status: "discarded" },
    });

    expect(auditMock).toHaveBeenCalledTimes(1);
    const [, entry] = auditMock.mock.calls[0];
    expect(entry).toMatchObject({
      action: "INGESTION_RUN_CANCELLED",
      result: "SUCCESS",
      resource: "run-1",
      resourceType: "IngestionRun",
      metadata: { previousStatus: "awaiting_review", itemsDiscarded: 3 },
    });
  });
});
