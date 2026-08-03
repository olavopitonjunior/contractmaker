/**
 * O que este arquivo protege: o relatório de API cross-tenant — onde o MCP
 * finalmente aparece (o sidecar fala com a REST por bearer, então cada tool
 * call já é linha de ApiUsage). Token identificado por NOME; token apagado
 * degrada pra "(token apagado)", não pra crash.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

function req(query = "") {
  return new NextRequest(`http://localhost/api/admin/metrics/api${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "staff-1" } } as never);
  mockPrisma.platformRole.findUnique.mockResolvedValue({
    userId: "staff-1",
    role: "support",
    scope: [],
  } as never);
  mockPrisma.apiUsage.groupBy.mockResolvedValue([] as never);
  mockPrisma.organization.findMany.mockResolvedValue([] as never);
  mockPrisma.userApiToken.findMany.mockResolvedValue([] as never);
});

describe("GET /api/admin/metrics/api", () => {
  it("401/403 sem sessão ou sem PlatformRole", async () => {
    mockAuth.mockResolvedValue(null as never);
    expect((await GET(req())).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "u" } } as never);
    mockPrisma.platformRole.findUnique.mockResolvedValue(null as never);
    expect((await GET(req())).status).toBe(403);
  });

  it("totais e errorRate saem do byVia/byStatus; token apagado degrada", async () => {
    // A rota faz 5 groupBy em paralelo — o mock responde por chamada, na
    // ordem do Promise.all (via, path, token, org, status).
    mockPrisma.apiUsage.groupBy
      .mockResolvedValueOnce([
        { via: "session", _count: { _all: 90 } },
        { via: "bearer", _count: { _all: 10 } },
      ] as never)
      .mockResolvedValueOnce([
        { path: "/api/deals", via: "bearer", _count: { _all: 10 } },
      ] as never)
      .mockResolvedValueOnce([
        { tokenId: "tok-vivo", _count: { _all: 7 } },
        { tokenId: "tok-apagado", _count: { _all: 3 } },
      ] as never)
      .mockResolvedValueOnce([
        { orgId: "org-1", _count: { _all: 100 } },
      ] as never)
      .mockResolvedValueOnce([
        { statusCode: 200, _count: { _all: 95 } },
        { statusCode: 401, _count: { _all: 4 } },
        { statusCode: 500, _count: { _all: 1 } },
      ] as never);
    mockPrisma.userApiToken.findMany.mockResolvedValue([
      { id: "tok-vivo", name: "Newton", scopes: ["deals:r"], revokedAt: null },
    ] as never);
    mockPrisma.organization.findMany.mockResolvedValue([
      { id: "org-1", name: "Newcore" },
    ] as never);

    const body = await (await GET(req())).json();
    expect(body.totals).toEqual({ calls: 100, errors: 5, errorRate: 5 });
    const nomes = Object.fromEntries(
      body.byToken.map((t: { name: string; calls: number }) => [t.name, t.calls])
    );
    expect(nomes["Newton"]).toBe(7);
    expect(nomes["(token apagado)"]).toBe(3);
    expect(body.byStatusClass).toEqual([
      { statusClass: "2xx", calls: 95 },
      { statusClass: "4xx", calls: 4 },
      { statusClass: "5xx", calls: 1 },
    ]);
  });
});
