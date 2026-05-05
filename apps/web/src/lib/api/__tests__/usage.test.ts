import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { recordApiUsage, cleanupOldApiUsage } from "../usage";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordApiUsage", () => {
  it("cria linha em ApiUsage com defaults corretos", async () => {
    vi.mocked(prisma.apiUsage.create).mockResolvedValue({} as never);
    await recordApiUsage({
      orgId: "org-1",
      userId: "u-1",
      tokenId: "tk-1",
      via: "bearer",
      method: "GET",
      path: "/api/me/metrics",
      statusCode: 200,
      latencyMs: 42,
    });
    expect(prisma.apiUsage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        tokenId: "tk-1",
        via: "bearer",
        statusCode: 200,
        latencyMs: 42,
        errorCode: null,
      }),
    });
  });

  it("nunca lança exceção mesmo se DB falhar", async () => {
    vi.mocked(prisma.apiUsage.create).mockRejectedValue(new Error("db down"));
    await expect(
      recordApiUsage({
        orgId: "x",
        userId: "x",
        via: "session",
        method: "GET",
        path: "/x",
        statusCode: 200,
        latencyMs: 1,
      })
    ).resolves.toBeUndefined();
  });
});

describe("cleanupOldApiUsage", () => {
  it("delega para deleteMany com cutoff de N dias atrás", async () => {
    vi.mocked(prisma.apiUsage.deleteMany).mockResolvedValue({ count: 42 } as never);
    const n = await cleanupOldApiUsage(30);
    expect(n).toBe(42);
    expect(prisma.apiUsage.deleteMany).toHaveBeenCalled();
    const arg = vi.mocked(prisma.apiUsage.deleteMany).mock.calls[0]![0];
    const cutoff = (arg!.where as { createdAt: { lt: Date } }).createdAt.lt;
    const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedMs)).toBeLessThan(2000);
  });
});
