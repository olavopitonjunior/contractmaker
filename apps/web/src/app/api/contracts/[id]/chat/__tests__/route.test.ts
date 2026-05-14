import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

// Mock o streamContractAgent — agora a rota é SSE.
vi.mock("@/lib/ai/agent", () => ({
  streamContractAgent: vi.fn(),
}));
import { streamContractAgent } from "@/lib/ai/agent";
const mockStreamAgent = vi.mocked(streamContractAgent);

function createRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/contracts/test-id/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function readSseEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<Record<string, unknown>> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
      if (line) events.push(JSON.parse(line));
    }
  }
  return events;
}

function mockGenerator(events: Array<Record<string, unknown>>) {
  return async function* () {
    for (const e of events) yield e as never;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

describe("POST /api/contracts/[id]/chat", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid payload (no message)", async () => {
    mockAuth.mockResolvedValue(createMockSession());
    const req = createRequest({});
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty message", async () => {
    mockAuth.mockResolvedValue(createMockSession());
    const req = createRequest({ message: "" });
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when contract not found", async () => {
    mockAuth.mockResolvedValue(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValue(null);
    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "nonexistent" } });
    expect(res.status).toBe(404);
  });

  it("returns 403 when contract is approved", async () => {
    mockAuth.mockResolvedValue(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValue({
      id: "test-id",
      status: "aprovado",
    } as never);
    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(403);
  });

  it("returns 403 when user has no org", async () => {
    mockAuth.mockResolvedValue(createMockSession());
    mockGetUserOrg.mockResolvedValue(null);
    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "test-id" } });
    expect(res.status).toBe(403);
  });

  it("returns SSE stream with done event on success", async () => {
    mockAuth.mockResolvedValue(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValue({
      id: "test-id",
      status: "rascunho",
    } as never);
    mockGetUserOrg.mockResolvedValue(createMockOrg());
    mockStreamAgent.mockImplementation(
      mockGenerator([
        { type: "started", mode: "plan", model: "claude-haiku-4-5", hasExpertContext: false },
        {
          type: "done",
          result: {
            message: "Contrato analisado.",
            htmlContent: "<p>Updated</p>",
            dataJson: { valor: 500000 },
            changeLogs: [{ action: "ai_edit", summary: "Editou", details: {}, source: "ai" }],
            events: [],
          },
        },
      ]) as never
    );

    const req = createRequest({ message: "Analise o contrato" });
    const res = await POST(req, { params: { id: "test-id" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSseEvents(res);
    const done = events.find((e) => e.type === "done") as { result: { message: string; htmlContent: string } };
    expect(done).toBeDefined();
    expect(done.result.message).toBe("Contrato analisado.");
    expect(done.result.htmlContent).toBe("<p>Updated</p>");
  });

  it("calls streamContractAgent with correct params including default mode 'plan'", async () => {
    mockAuth.mockResolvedValue(createMockSession({ id: "user-42" }));
    mockPrisma.contract.findUnique.mockResolvedValue({
      id: "contract-99",
      status: "rascunho",
    } as never);
    mockGetUserOrg.mockResolvedValue(createMockOrg({ id: "org-7" }));
    mockStreamAgent.mockImplementation(
      mockGenerator([
        {
          type: "done",
          result: { message: "OK", htmlContent: null, dataJson: null, changeLogs: [], events: [] },
        },
      ]) as never
    );

    const req = createRequest({ message: "test msg" });
    const res = await POST(req, { params: { id: "contract-99" } });
    await readSseEvents(res);

    expect(mockStreamAgent).toHaveBeenCalledWith({
      message: "test msg",
      contractId: "contract-99",
      userId: "user-42",
      orgId: "org-7",
      mode: "plan",
    });
  });

  it("propagates mode='fast' when client sends it", async () => {
    mockAuth.mockResolvedValue(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValue({
      id: "test-id",
      status: "rascunho",
    } as never);
    mockStreamAgent.mockImplementation(
      mockGenerator([
        {
          type: "done",
          result: { message: "OK", htmlContent: null, dataJson: null, changeLogs: [], events: [] },
        },
      ]) as never
    );

    const req = createRequest({ message: "altere", mode: "fast" });
    const res = await POST(req, { params: { id: "test-id" } });
    await readSseEvents(res);

    expect(mockStreamAgent).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "fast" })
    );
  });

  it("emits error event when agent generator throws", async () => {
    mockAuth.mockResolvedValue(createMockSession());
    mockPrisma.contract.findUnique.mockResolvedValue({
      id: "test-id",
      status: "rascunho",
    } as never);
    mockGetUserOrg.mockResolvedValue(createMockOrg());
    mockStreamAgent.mockImplementation((async function* () {
      throw new Error("API timeout");
    }) as never);

    const req = createRequest({ message: "test" });
    const res = await POST(req, { params: { id: "test-id" } });

    expect(res.status).toBe(200);
    const events = await readSseEvents(res);
    const errEvt = events.find((e) => e.type === "error") as { message: string };
    expect(errEvt).toBeDefined();
    expect(errEvt.message).toBe("API timeout");
  });
});
