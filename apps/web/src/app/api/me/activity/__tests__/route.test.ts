import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeReq(query = "", headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/me/activity${query}`, { headers });
}

describe("GET /api/me/activity", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("400 quando limit não-inteiro válido", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await GET(makeReq("?limit=abc"));
    expect(res.status).toBe(400);
  });

  it("400 quando since não é ISO", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await GET(makeReq("?since=invalid"));
    expect(res.status).toBe(400);
  });

  it("clamp de limit em 200 (boundary)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);
    await GET(makeReq("?limit=99999"));
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 })
    );
  });

  it("clamp de limit em 1 (boundary inferior)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);
    await GET(makeReq("?limit=0"));
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 })
    );
  });

  it("filtra por userId do autenticado", async () => {
    mockAuth.mockResolvedValue(
      createMockSession({ id: "u-special" }) as never
    );
    mockPrisma.auditLog.findMany.mockResolvedValue([] as never);
    await GET(makeReq());
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u-special" }),
      })
    );
  });

  it("retorna items + count", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: "a1",
        action: "CHARGE_CREATE",
        result: "SUCCESS",
        resource: "ch1",
        resourceType: "CommissionCharge",
        metadata: { via: "newton" },
        createdAt: new Date("2026-05-01"),
      },
    ] as never);
    const res = await GET(makeReq("?limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].action).toBe("CHARGE_CREATE");
    expect(body.count).toBe(1);
  });
});
