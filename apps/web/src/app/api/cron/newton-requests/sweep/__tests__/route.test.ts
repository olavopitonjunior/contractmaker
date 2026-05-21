import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { triggerNewtonForRequest } from "@/lib/newton/trigger";

vi.mock("@/lib/newton/trigger", () => ({
  triggerNewtonForRequest: vi.fn(() => Promise.resolve()),
}));

const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "nr1",
    dealId: "d1",
    ask: "matrícula",
    targetType: "contact",
    targetRef: "5511987654321",
    targetLabel: null,
    status: "chasing",
    priority: "normal",
    lastNudgeAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function req() {
  return new NextRequest("http://localhost/api/cron/newton-requests/sweep");
}

/** Fixa o relógio numa hora dentro/fora da janela SP (UTC-3). */
function freezeAtSpHour(spHour: number) {
  // spHour SP = (spHour + 3) UTC
  const d = new Date(Date.UTC(2026, 4, 21, (spHour + 3) % 24, 0, 0));
  vi.useFakeTimers();
  vi.setSystemTime(d);
}

describe("GET /api/cron/newton-requests/sweep", () => {
  it("403 com CRON_SECRET errado", async () => {
    process.env.CRON_SECRET = "secret";
    const r = new NextRequest("http://localhost/api/cron/newton-requests/sweep", {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await GET(r);
    expect(res.status).toBe(403);
  });

  it("pula fora da janela 7h-22h SP", async () => {
    freezeAtSpHour(3); // 03h SP
    const res = await GET(req());
    const body = await res.json();
    expect(body.skipped).toBeDefined();
    expect(mockPrisma.newtonRequest.findMany).not.toHaveBeenCalled();
  });

  it("re-dispara pendentes na janela e marca lastNudgeAt", async () => {
    freezeAtSpHour(10); // 10h SP
    mockPrisma.newtonRequest.findMany.mockResolvedValue([
      row({ id: "a", status: "chasing" }),
      row({ id: "b", status: "open" }),
    ] as never);
    mockPrisma.newtonRequest.updateMany.mockResolvedValue({ count: 2 } as never);

    const res = await GET(req());
    const body = await res.json();
    expect(body.swept).toBe(2);
    expect(mockPrisma.newtonRequest.updateMany).toHaveBeenCalledOnce();
    expect(triggerNewtonForRequest).toHaveBeenCalledTimes(2);
    // "open" → create (1ª cobrança); "chasing" → remind.
    const kinds = vi.mocked(triggerNewtonForRequest).mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain("remind");
    expect(kinds).toContain("create");
  });

  it("swept 0 quando não há candidatos", async () => {
    freezeAtSpHour(15);
    mockPrisma.newtonRequest.findMany.mockResolvedValue([] as never);
    const res = await GET(req());
    const body = await res.json();
    expect(body.swept).toBe(0);
    expect(mockPrisma.newtonRequest.updateMany).not.toHaveBeenCalled();
  });
});
