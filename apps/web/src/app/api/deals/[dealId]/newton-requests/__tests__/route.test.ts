import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

// Não queremos rede no trigger; sem env de sidecar ele é no-op.
vi.mock("@/lib/newton/trigger", () => ({
  // Retorna Promise: o handler envolve em waitUntil, que exige um Promise.
  triggerNewtonForRequest: vi.fn(() => Promise.resolve()),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

/** O Newton é feature por tenant e nasce DESLIGADA — org de teste tem que ligar. */
function enableNewton(enabled = true) {
  mockPrisma.orgModule.findMany.mockResolvedValue([
    { module: "vendas", enabled: true, featureFlags: { "vendas.newton": enabled } },
    { module: "locacao", enabled: true, featureFlags: { "locacao.newton": enabled } },
  ] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
  enableNewton();
});

const baseDeal = { id: "d1", kind: "venda", form: { orgId: "org-1" }, pipeline: { orgId: "org-1" } };

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "nr1",
    orgId: "org-1",
    dealId: "d1",
    createdBy: "user-1",
    ask: "matrícula atualizada",
    targetType: "contact",
    targetRef: "5511987654321",
    targetLabel: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    cronJobIds: [],
    lastNudgeAt: null,
    resolutionNote: null,
    eventsJson: [{ at: new Date().toISOString(), actor: "negociadora", type: "created" }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/deals/d1/newton-requests", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = { ask: "matrícula atualizada do imóvel", targetType: "contact", targetRef: "5511987654321" };

describe("POST /api/deals/[dealId]/newton-requests", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("400 ask muito curto", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await POST(makeReq({ ask: "x", targetType: "group" }), { params: { dealId: "d1" } });
    expect(res.status).toBe(400);
  });

  it("400 contact sem targetRef", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await POST(
      makeReq({ ask: "preciso da matrícula", targetType: "contact" }),
      { params: { dealId: "d1" } }
    );
    expect(res.status).toBe(400);
  });

  it("404 deal inexistente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("403 deal de outra org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      id: "d1",
      form: null,
      pipeline: { orgId: "org-2" },
    } as never);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("201 registra o pedido SEM cutucar o WhatsApp", async () => {
    const { triggerNewtonForRequest } = await import("@/lib/newton/trigger");
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.newtonRequest.create.mockResolvedValue(makeRequestRow() as never);

    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("nr1");
    expect(body.status).toBe("open");
    // O inbox é registro interno desde 2026-07-25: nenhum turn no sidecar.
    expect(triggerNewtonForRequest).not.toHaveBeenCalled();
  });

  it("403 quando o tenant não tem o Newton (default do catálogo)", async () => {
    const { triggerNewtonForRequest } = await import("@/lib/newton/trigger");
    enableNewton(false);
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);

    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "MODULE_DISABLED" });
    // E o mais importante: nada é criado nem cutucado no WhatsApp.
    expect(mockPrisma.newtonRequest.create).not.toHaveBeenCalled();
    expect(triggerNewtonForRequest).not.toHaveBeenCalled();
  });
});

describe("GET /api/deals/[dealId]/newton-requests", () => {
  it("lista pedidos do deal", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.newtonRequest.findMany.mockResolvedValue([makeRequestRow()] as never);

    const req = new NextRequest("http://localhost/api/deals/d1/newton-requests");
    const res = await GET(req, { params: { dealId: "d1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].id).toBe("nr1");
  });
});
