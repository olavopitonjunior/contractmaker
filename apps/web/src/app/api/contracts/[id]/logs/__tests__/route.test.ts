import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

function createRequest() {
  return new NextRequest("http://localhost/api/contracts/test-id/logs", {
    method: "GET",
  });
}

// mockResolvedValue (não -Once): além do contractBelongsToOrg, o guard de
// escopo do gerente (guardContractScope) faz um segundo findUnique.
function mockContractInOrg(orgId: string) {
  mockPrisma.contract.findUnique.mockResolvedValue({
    deal: { userId: "user-1", managerUserId: null, pipeline: { orgId } },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue({ id: "org-1" } as any);
});

describe("GET /api/contracts/[id]/logs", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET(createRequest(), { params: { id: "test-id" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when contract belongs to another org", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockContractInOrg("org-OUTRA");

    const res = await GET(createRequest(), { params: { id: "test-id" } });

    expect(res.status).toBe(404);
    expect(mockPrisma.contractChangeLog.findMany).not.toHaveBeenCalled();
  });

  it("returns logs array ordered by createdAt desc", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockContractInOrg("org-1");
    const mockLogs = [
      {
        id: "log-2",
        action: "ai_edit",
        summary: "Editou seção",
        createdAt: new Date("2026-04-10"),
        user: { name: "Admin", email: "admin@test.com" },
      },
      {
        id: "log-1",
        action: "status_change",
        summary: "Aprovado",
        createdAt: new Date("2026-04-09"),
        user: { name: "Admin", email: "admin@test.com" },
      },
    ];
    mockPrisma.contractChangeLog.findMany.mockResolvedValueOnce(
      mockLogs as any
    );

    const res = await GET(createRequest(), { params: { id: "test-id" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveLength(2);
    expect(json[0].id).toBe("log-2");
  });

  it("queries with correct params", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockContractInOrg("org-1");
    mockPrisma.contractChangeLog.findMany.mockResolvedValueOnce([]);

    await GET(createRequest(), { params: { id: "contract-99" } });

    expect(mockPrisma.contractChangeLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contractId: "contract-99" },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          user: { select: { name: true, email: true } },
        },
      })
    );
  });
});
