import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

// Mock the agent module
vi.mock("@/lib/ai/agent", () => ({
  runContractAgent: vi.fn(),
}));
import { runContractAgent } from "@/lib/ai/agent";
const mockRunAgent = vi.mocked(runContractAgent);

function createRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/contracts/test-id/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contracts/[id]/chat", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid payload (no message)", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    const req = createRequest({});
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty message", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    const req = createRequest({ message: "" });
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when contract not found", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce(null);
    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "nonexistent" } });
    expect(res.status).toBe(404);
  });

  it("returns 403 when contract is approved", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "test-id",
      status: "aprovado",
    } as any);
    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(403);
  });

  it("returns 400 when user has no org", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "test-id",
      status: "rascunho",
    } as any);
    mockGetUserOrg.mockResolvedValueOnce(null);
    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(400);
  });

  it("returns 200 with agent result on success", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "test-id",
      status: "rascunho",
    } as any);
    mockGetUserOrg.mockResolvedValueOnce(createMockOrg());
    mockRunAgent.mockResolvedValueOnce({
      message: "Contrato analisado.",
      htmlContent: "<p>Updated</p>",
      dataJson: { valor: 500000 },
      changeLogs: [{ action: "ai_edit", summary: "Editou", details: {}, source: "ai" }],
    });

    const req = createRequest({ message: "Analise o contrato" });
    const res = await POST(req, { params: { id: "test-id" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe("Contrato analisado.");
    expect(json.htmlContent).toBe("<p>Updated</p>");
    expect(json.toolsUsed).toEqual(["ai_edit"]);
  });

  it("calls runContractAgent with correct params", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession({ id: "user-42" }));
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "contract-99",
      status: "rascunho",
    } as any);
    mockGetUserOrg.mockResolvedValueOnce(createMockOrg({ id: "org-7" }));
    mockRunAgent.mockResolvedValueOnce({
      message: "OK",
      htmlContent: null,
      dataJson: null,
      changeLogs: [],
    });

    const req = createRequest({ message: "test msg" });
    await POST(req, { params: { id: "contract-99" } });

    expect(mockRunAgent).toHaveBeenCalledWith({
      message: "test msg",
      contractId: "contract-99",
      userId: "user-42",
      orgId: "org-7",
    });
  });

  it("returns 500 when agent throws", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      id: "test-id",
      status: "rascunho",
    } as any);
    mockGetUserOrg.mockResolvedValueOnce(createMockOrg());
    mockRunAgent.mockRejectedValueOnce(new Error("API timeout"));

    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "test-id" } });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("API timeout");
  });
});
