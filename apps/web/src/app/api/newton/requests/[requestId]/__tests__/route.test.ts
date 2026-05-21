import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { emitNotification } from "@/lib/notifications/emit";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

vi.mock("@/lib/notifications/emit", () => ({
  // Retorna Promise: o handler envolve em waitUntil, que exige um Promise.
  emitNotification: vi.fn(() => Promise.resolve()),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "nr1",
    orgId: "org-1",
    dealId: "d1",
    createdBy: "user-9",
    ask: "matrícula atualizada",
    targetType: "contact",
    targetRef: "5511987654321",
    targetLabel: null,
    status: "chasing",
    priority: "normal",
    dueAt: null,
    cronJobIds: ["cron-a"],
    lastNudgeAt: null,
    resolutionNote: null,
    eventsJson: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/newton/requests/nr1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/newton/requests/[requestId]", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeReq({ action: "chasing" }), { params: { requestId: "nr1" } });
    expect(res.status).toBe(401);
  });

  it("404 pedido inexistente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.newtonRequest.findUnique.mockResolvedValue(null as never);
    const res = await PATCH(makeReq({ action: "chasing" }), { params: { requestId: "nr1" } });
    expect(res.status).toBe(404);
  });

  it("403 pedido de outra org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.newtonRequest.findUnique.mockResolvedValue(existingRow({ orgId: "org-2" }) as never);
    const res = await PATCH(makeReq({ action: "chasing" }), { params: { requestId: "nr1" } });
    expect(res.status).toBe(403);
  });

  it("chasing acumula cronJobIds (dedupe)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.newtonRequest.findUnique.mockResolvedValue(existingRow() as never);
    mockPrisma.newtonRequest.update.mockResolvedValue(
      existingRow({ status: "chasing", cronJobIds: ["cron-a", "cron-b"] }) as never
    );

    const res = await PATCH(
      makeReq({ action: "chasing", cronJobIds: ["cron-a", "cron-b"] }),
      { params: { requestId: "nr1" } }
    );
    expect(res.status).toBe(200);
    const updateArg = mockPrisma.newtonRequest.update.mock.calls[0][0] as {
      data: { cronJobIds: string[] };
    };
    expect(updateArg.data.cronJobIds.sort()).toEqual(["cron-a", "cron-b"]);
  });

  it("fulfilled fecha e notifica a negociadora", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.newtonRequest.findUnique.mockResolvedValue(existingRow() as never);
    mockPrisma.newtonRequest.update.mockResolvedValue(
      existingRow({ status: "fulfilled", resolutionNote: "matrícula recebida" }) as never
    );

    const res = await PATCH(
      makeReq({ action: "fulfilled", resolutionNote: "matrícula recebida" }),
      { params: { requestId: "nr1" } }
    );
    expect(res.status).toBe(200);
    expect(emitNotification).toHaveBeenCalledOnce();
    const arg = vi.mocked(emitNotification).mock.calls[0][0];
    expect(arg.userId).toBe("user-9");
    expect(arg.type).toBe("newton_request_fulfilled");
    expect(arg.linkUrl).toBe("/deals/d1");
  });

  it("409 em pedido cancelado", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.newtonRequest.findUnique.mockResolvedValue(existingRow({ status: "cancelled" }) as never);
    const res = await PATCH(makeReq({ action: "chasing" }), { params: { requestId: "nr1" } });
    expect(res.status).toBe(409);
  });
});
