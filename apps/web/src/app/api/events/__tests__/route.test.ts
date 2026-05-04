import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
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

function makeReq(query = "", headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/events${query}`, { headers });
}

describe("GET /api/events", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq("?since=2026-01-01T00:00:00Z"));
    expect(res.status).toBe(401);
  });

  it("400 quando since ausente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(400);
  });

  it("400 quando since não é ISO", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await GET(makeReq("?since=invalid"));
    expect(res.status).toBe(400);
  });

  it("400 quando limit não é inteiro", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await GET(makeReq("?since=2026-01-01T00:00:00Z&limit=xyz"));
    expect(res.status).toBe(400);
  });

  it("clamp de limit em 500", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);
    await GET(makeReq("?since=2026-01-01T00:00:00Z&limit=99999"));
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 })
    );
  });

  it("403 quando usuário não tem org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockGetUserOrg.mockResolvedValue(null);
    const res = await GET(makeReq("?since=2026-01-01T00:00:00Z"));
    expect(res.status).toBe(403);
  });

  it("filtra por orgId do usuário e since", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockGetUserOrg.mockResolvedValue({ id: "org-x" } as never);
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);

    await GET(makeReq("?since=2026-05-01T00:00:00Z"));
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-x",
          createdAt: { gt: new Date("2026-05-01T00:00:00Z") },
        }),
      })
    );
  });

  it("aplica filtro de actions quando fornecido", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);

    await GET(
      makeReq("?since=2026-05-01T00:00:00Z&actions=CHARGE_CREATE,API_TOKEN_CREATED")
    );
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: { in: ["CHARGE_CREATE", "API_TOKEN_CREATED"] },
        }),
      })
    );
  });

  it("retorna events + nextSince calculado do último evento + 1ms", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const lastTs = new Date("2026-05-02T15:30:00Z");
    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: "a1",
        action: "DEAL_CREATE",
        result: "SUCCESS",
        resource: "d1",
        resourceType: "Deal",
        metadata: {},
        createdAt: new Date("2026-05-02T10:00:00Z"),
        userId: "u1",
      },
      {
        id: "a2",
        action: "CHARGE_CREATE",
        result: "SUCCESS",
        resource: "ch1",
        resourceType: "CommissionCharge",
        metadata: { via: "newton" },
        createdAt: lastTs,
        userId: "u1",
      },
    ] as never);

    const res = await GET(makeReq("?since=2026-05-01T00:00:00Z"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.events).toHaveLength(2);
    // nextSince = ts do último + 1ms
    expect(new Date(body.nextSince).getTime()).toBe(lastTs.getTime() + 1);
  });

  it("nextSince = since quando não há eventos novos", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);
    const sinceParam = "2026-05-01T00:00:00.000Z";
    const res = await GET(makeReq(`?since=${sinceParam}`));
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.nextSince).toBe(sinceParam);
  });
});
