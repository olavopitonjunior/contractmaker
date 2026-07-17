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
  return new NextRequest("http://localhost/api/forms", init);
}

describe("POST /api/forms (retrofit Newton)", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq({ title: "x" }));
    expect(res.status).toBe(401);
  });

  it("403 sem escopo documents:rw (bearer)", async () => {
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

  it("cria form sem deal quando pipeline vazia", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.salesForm.create.mockResolvedValue({
      id: "f1",
      token: "tok123abc",
    } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue(null as never);

    const res = await POST(makeReq({ title: "Maria" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("f1");
    expect(body.dealId).toBeNull();
    expect(body.url).toBe("/f/tok123abc");
  });

  it("cria form + deal quando pipeline configurada", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.salesForm.create.mockResolvedValue({
      id: "f1",
      token: "tok",
    } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({
      id: "p1",
      stages: [{ id: "s1", name: "Formulário" }],
    } as never);
    mockPrisma.deal.count.mockResolvedValue(2 as never);
    mockPrisma.deal.create.mockResolvedValue({ id: "d1" } as never);

    const res = await POST(makeReq({ title: "x" }));
    const body = await res.json();
    expect(body.dealId).toBe("d1");
  });

  it("audita FORM_CREATE com via=newton quando bearer", async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u-bearer",
      scopes: ["documents:rw"],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockResolvedValue({} as never);
    mockPrisma.salesForm.create.mockResolvedValue({
      id: "f1",
      token: "t",
    } as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue(null as never);

    await POST(
      makeReq({ title: "x" }, { Authorization: "Bearer cmt_x" })
    );
    const auditCall = mockPrisma.auditLog.create.mock.calls[0]![0] as {
      data: { action: string; metadata: Record<string, unknown> };
    };
    expect(auditCall.data.action).toBe("FORM_CREATE");
    expect(auditCall.data.metadata.via).toBe("newton");
  });

  it("409 duplicate_recent quando existe deal com mesmo título criado há pouco", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({
      id: "p1",
      stages: [{ id: "s1", name: "Formulário" }],
    } as never);
    mockPrisma.deal.findFirst.mockResolvedValue({
      id: "d-dup",
      title: "Venda Apto 302",
      createdAt: new Date(),
    } as never);

    const res = await POST(makeReq({ title: "Venda Apto 302" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("duplicate_recent");
    expect(body.existing.id).toBe("d-dup");
    expect(mockPrisma.salesForm.create).not.toHaveBeenCalled();
  });

  it("force: true fura o soft-block de título repetido", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.pipeline.findFirst.mockResolvedValue({
      id: "p1",
      stages: [{ id: "s1", name: "Formulário" }],
    } as never);
    mockPrisma.salesForm.create.mockResolvedValue({
      id: "f1",
      token: "tok",
    } as never);
    mockPrisma.deal.count.mockResolvedValue(0 as never);
    mockPrisma.deal.create.mockResolvedValue({ id: "d1" } as never);

    const res = await POST(makeReq({ title: "Venda Apto 302", force: true }));
    expect(res.status).toBe(201);
    // Com force, o dup-check nem roda.
    expect(mockPrisma.deal.findFirst).not.toHaveBeenCalled();
  });

  it("idempotency replay retorna mesma resposta", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      statusCode: 201,
      responseBody: { id: "f-cached", token: "cached" },
      responseHash: "h",
      createdAt: new Date(),
    } as never);

    const res = await POST(
      makeReq({ title: "x" }, { "X-Idempotency-Key": "k1" })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe("cached");
    expect(mockPrisma.salesForm.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/forms (retrofit Newton)", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("retorna forms da org filtrados", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.salesForm.findMany.mockResolvedValue([
      { id: "f1", token: "t1", deal: { id: "d1", title: "x" } },
    ] as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(mockPrisma.salesForm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-1" },
      })
    );
  });
});
