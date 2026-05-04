import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

function makeReq(body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = body
    ? {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", ...headers },
      }
    : { headers };
  return new NextRequest("http://localhost/api/pipeline/deals", init);
}

const stage = { id: "stage-1", position: 0, name: "Lead" };
const pipeline = {
  id: "pipe-1",
  orgId: "org-1",
  stages: [stage],
};

describe("POST /api/pipeline/deals (retrofit Newton)", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq({ title: "x" }));
    expect(res.status).toBe(401);
  });

  it("403 com bearer sem deals:rw", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      scopes: ["metrics:r"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);

    const res = await POST(
      makeReq({ title: "x" }, { Authorization: "Bearer cmt_x" })
    );
    expect(res.status).toBe(403);
  });

  it("400 quando title ausente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("400 quando pipeline não configurada", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue(null as never);
    const res = await POST(makeReq({ title: "Maria 500k" }));
    expect(res.status).toBe(400);
  });

  it("cria deal e auditoria com via undefined (session)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue(pipeline as never);
    mockPrisma.deal.count.mockResolvedValue(2 as never);
    mockPrisma.deal.create.mockResolvedValue({
      id: "deal-1",
      title: "Maria 500k",
    } as never);

    const res = await POST(makeReq({ title: "Maria 500k", value: 500000 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("deal-1");
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DEAL_CREATE",
          result: "SUCCESS",
        }),
      })
    );
    // Sem via=newton (session)
    const auditCall = mockPrisma.auditLog.create.mock.calls[0][0] as {
      data: { metadata: Record<string, unknown> };
    };
    expect(auditCall.data.metadata.via).toBeUndefined();
  });

  it("via=newton no audit quando bearer", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u-bearer",
      scopes: ["deals:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue(pipeline as never);
    mockPrisma.deal.count.mockResolvedValue(0 as never);
    mockPrisma.deal.create.mockResolvedValue({
      id: "deal-2",
      title: "Newton-created",
    } as never);

    await POST(
      makeReq(
        { title: "Newton-created" },
        { Authorization: "Bearer cmt_x" }
      )
    );
    const auditCall = mockPrisma.auditLog.create.mock.calls[0][0] as {
      data: { metadata: Record<string, unknown> };
    };
    expect(auditCall.data.metadata.via).toBe("newton");
  });

  it("idempotency: replay retorna mesma resposta sem criar deal de novo", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    // Cache hit
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      statusCode: 201,
      responseBody: { id: "deal-replay", title: "x" },
      responseHash: "hash",
      createdAt: new Date(),
    } as never);

    const res = await POST(
      makeReq({ title: "x" }, { "X-Idempotency-Key": "key-1" })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("deal-replay");
    // deal.create NÃO foi chamado pq replayed
    expect(mockPrisma.deal.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/pipeline/deals (retrofit Newton)", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("retorna [] quando não há pipeline", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue(null as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("retorna deals da pipeline da org do user", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({
      id: "pipe-1",
    } as never);
    mockPrisma.deal.findMany.mockResolvedValue([
      { id: "d1", title: "x" },
    ] as never);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});
