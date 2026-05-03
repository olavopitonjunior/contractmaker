import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hashResponseBody,
  getCachedResponse,
  persistResponse,
  withIdempotency,
} from "../idempotency";
import { prisma } from "@/lib/db/prisma";

const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hashResponseBody", () => {
  it("returns 64-char hex sha256", () => {
    const h = hashResponseBody({ ok: true });
    expect(h.length).toBe(64);
    expect(/^[a-f0-9]{64}$/.test(h)).toBe(true);
  });

  it("is deterministic for same payload", () => {
    expect(hashResponseBody({ a: 1, b: 2 })).toBe(
      hashResponseBody({ a: 1, b: 2 })
    );
  });

  it("differs for different payloads", () => {
    expect(hashResponseBody({ a: 1 })).not.toBe(hashResponseBody({ a: 2 }));
  });
});

describe("getCachedResponse", () => {
  it("returns null when no record", async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null as never);
    const r = await getCachedResponse("u1", "k1");
    expect(r).toBeNull();
  });

  it("returns null when record older than 24h (stale ignore)", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      statusCode: 200,
      responseBody: { ok: true },
      responseHash: "abc",
      createdAt: old,
    } as never);
    const r = await getCachedResponse("u1", "k1");
    expect(r).toBeNull();
  });

  it("returns cached response when fresh", async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      statusCode: 201,
      responseBody: { id: "x" },
      responseHash: "hash",
      createdAt: new Date(),
    } as never);
    const r = await getCachedResponse("u1", "k1");
    expect(r).toEqual({
      status: 201,
      body: { id: "x" },
      hash: "hash",
    });
  });
});

describe("withIdempotency", () => {
  it("executes handler when no key provided", async () => {
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { ok: 1 } });
    const result = await withIdempotency({
      userId: "u1",
      key: null,
      method: "POST",
      path: "/api/x",
      handler,
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(result.replayed).toBe(false);
    expect(result.status).toBe(200);
  });

  it("returns cached response without calling handler when replay hits", async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      statusCode: 201,
      responseBody: { id: "cached" },
      responseHash: "hash",
      createdAt: new Date(),
    } as never);
    const handler = vi.fn();
    const result = await withIdempotency({
      userId: "u1",
      key: "k1",
      method: "POST",
      path: "/api/x",
      handler,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(result.replayed).toBe(true);
    expect(result.body).toEqual({ id: "cached" });
  });

  it("persists response when key present and status < 500", async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null as never);
    mockPrisma.idempotencyKey.upsert.mockResolvedValueOnce({} as never);
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { id: "new" } });
    await withIdempotency({
      userId: "u1",
      key: "k1",
      method: "POST",
      path: "/api/x",
      handler,
    });
    expect(mockPrisma.idempotencyKey.upsert).toHaveBeenCalledOnce();
  });

  it("does NOT persist 5xx responses (transient — retry should redo)", async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null as never);
    const handler = vi.fn().mockResolvedValue({ status: 502, body: { error: "upstream" } });
    await withIdempotency({
      userId: "u1",
      key: "k1",
      method: "POST",
      path: "/api/x",
      handler,
    });
    expect(mockPrisma.idempotencyKey.upsert).not.toHaveBeenCalled();
  });
});

describe("persistResponse", () => {
  it("upserts with userId+key composite", async () => {
    mockPrisma.idempotencyKey.upsert.mockResolvedValueOnce({} as never);
    await persistResponse({
      userId: "u1",
      key: "k1",
      method: "POST",
      path: "/api/x",
      status: 200,
      body: { ok: true },
    });
    expect(mockPrisma.idempotencyKey.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_key: { userId: "u1", key: "k1" } },
        create: expect.objectContaining({
          userId: "u1",
          key: "k1",
          method: "POST",
          path: "/api/x",
          statusCode: 200,
        }),
      })
    );
  });
});
