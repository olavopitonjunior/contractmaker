/**
 * O que este arquivo protege: o rollup de auditoria cross-tenant — a lista
 * de FAILURE/DENIED por org que alimenta o motor de alerta da fase 2. Linha
 * sem org (evento de plataforma) rotula "Plataforma", não some.
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
  return new NextRequest(`http://localhost/api/admin/metrics/audit${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "staff-1" } } as never);
  mockPrisma.platformRole.findUnique.mockResolvedValue({
    userId: "staff-1",
    role: "support",
    scope: [],
  } as never);
  mockPrisma.auditLog.groupBy.mockResolvedValue([] as never);
  mockPrisma.organization.findMany.mockResolvedValue([] as never);
});

describe("GET /api/admin/metrics/audit", () => {
  it("403 sem PlatformRole", async () => {
    mockPrisma.platformRole.findUnique.mockResolvedValue(null as never);
    expect((await GET(req())).status).toBe(403);
  });

  it("problems resolve nome da org e rotula orgId nulo como Plataforma", async () => {
    mockPrisma.auditLog.groupBy
      .mockResolvedValueOnce([
        { action: "CLICKSIGN_WEBHOOK", _count: { _all: 40 } },
      ] as never)
      .mockResolvedValueOnce([
        { result: "SUCCESS", _count: { _all: 38 } },
        { result: "FAILURE", _count: { _all: 2 } },
      ] as never)
      .mockResolvedValueOnce([
        {
          orgId: "org-1",
          action: "KYC_SUBMIT",
          result: "FAILURE",
          _count: { _all: 2 },
        },
        {
          orgId: null,
          action: "API_TOKEN_AUTH_FAILED",
          result: "DENIED",
          _count: { _all: 1 },
        },
      ] as never);
    mockPrisma.organization.findMany.mockResolvedValue([
      { id: "org-1", name: "Newcore" },
    ] as never);

    const body = await (await GET(req())).json();
    expect(body.problems).toEqual([
      {
        orgId: "org-1",
        orgName: "Newcore",
        action: "KYC_SUBMIT",
        result: "FAILURE",
        count: 2,
      },
      {
        orgId: null,
        orgName: "Plataforma",
        action: "API_TOKEN_AUTH_FAILED",
        result: "DENIED",
        count: 1,
      },
    ]);
    expect(body.topActions[0]).toEqual({ action: "CLICKSIGN_WEBHOOK", count: 40 });
  });
});
