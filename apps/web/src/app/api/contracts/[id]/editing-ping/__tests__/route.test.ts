import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/contracts/editor-presence", () => ({
  markContractEditorPresence: vi.fn(),
}));
vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { markContractEditorPresence } from "@/lib/contracts/editor-presence";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { createMockSession } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);
const mockMark = vi.mocked(markContractEditorPresence);
const mockEffective = vi.mocked(getEffectiveUserId);

function createRequest() {
  return new NextRequest("http://localhost/api/contracts/c1/editing-ping", {
    method: "POST",
  });
}

function mockContractInOrg(orgId: string) {
  mockPrisma.contract.findUnique.mockResolvedValueOnce({
    deal: { pipeline: { orgId } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue({ id: "org-1" } as never);
  mockEffective.mockImplementation(async (id: string) => id);
});

describe("POST /api/contracts/[id]/editing-ping", () => {
  it("401 sem sessão — e não grava presença", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(createRequest(), { params: { id: "c1" } });
    expect(res.status).toBe(401);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("404 quando o contrato é de outra org (sem vazar existência)", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockContractInOrg("org-OUTRA");
    const res = await POST(createRequest(), { params: { id: "c1" } });
    expect(res.status).toBe(404);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("grava a presença do usuário efetivo no contrato", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession({ id: "user-1" }));
    mockContractInOrg("org-1");
    const res = await POST(createRequest(), { params: { id: "c1" } });
    expect(res.status).toBe(200);
    expect(mockMark).toHaveBeenCalledWith("c1", "user-1");
  });

  it("sob impersonation, atribui ao usuário efetivo (dono do tenant)", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession({ id: "super-admin" }));
    mockContractInOrg("org-1");
    mockEffective.mockResolvedValueOnce("owner-do-tenant");
    await POST(createRequest(), { params: { id: "c1" } });
    expect(mockMark).toHaveBeenCalledWith("c1", "owner-do-tenant");
  });
});
