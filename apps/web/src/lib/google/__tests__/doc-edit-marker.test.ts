import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));
vi.mock("@upstash/redis", () => ({
  // Classe (não arrow-fn) pra funcionar com `new Redis(...)`.
  Redis: class {
    get = mockGet;
    set = mockSet;
  },
}));

import {
  markProgrammaticDocEdit,
  checkDocEcho,
  __resetDocEditMarkerClientForTests,
} from "../doc-edit-marker";

const OLD_ENV = { ...process.env };

function withRedis() {
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
  delete process.env.REDIS_KEY_PREFIX;
  __resetDocEditMarkerClientForTests();
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  __resetDocEditMarkerClientForTests();
});

describe("doc-edit-marker", () => {
  it("sem Redis configurado → checkDocEcho 'unknown' e mark é no-op", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetDocEditMarkerClientForTests();

    expect(await checkDocEcho("doc1")).toBe("unknown");
    await markProgrammaticDocEdit("doc1");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("markProgrammaticDocEdit seta a chave com TTL", async () => {
    withRedis();
    mockSet.mockResolvedValue("OK");
    await markProgrammaticDocEdit("doc1");
    expect(mockSet).toHaveBeenCalledWith(
      "prog-doc-edit:doc1",
      "1",
      expect.objectContaining({ ex: expect.any(Number) })
    );
  });

  it("dedup: mark 2x mesmo docId em <10s → Redis SET só 1x; docId diferente → 2x", async () => {
    withRedis();
    mockSet.mockResolvedValue("OK");
    await markProgrammaticDocEdit("docA");
    await markProgrammaticDocEdit("docA"); // dedup in-memory → não seta de novo
    expect(mockSet).toHaveBeenCalledTimes(1);
    await markProgrammaticDocEdit("docB"); // outro doc → seta
    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  it("checkDocEcho: chave presente → 'echo'", async () => {
    withRedis();
    mockGet.mockResolvedValue("1");
    expect(await checkDocEcho("doc1")).toBe("echo");
    expect(mockGet).toHaveBeenCalledWith("prog-doc-edit:doc1");
  });

  it("checkDocEcho: chave ausente (null) → 'manual'", async () => {
    withRedis();
    mockGet.mockResolvedValue(null);
    expect(await checkDocEcho("doc1")).toBe("manual");
  });

  it("checkDocEcho: docId vazio → 'unknown'", async () => {
    withRedis();
    expect(await checkDocEcho("")).toBe("unknown");
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("respeita REDIS_KEY_PREFIX", async () => {
    withRedis();
    process.env.REDIS_KEY_PREFIX = "staging:";
    __resetDocEditMarkerClientForTests();
    mockGet.mockResolvedValue(null);
    await checkDocEcho("doc1");
    expect(mockGet).toHaveBeenCalledWith("staging:prog-doc-edit:doc1");
  });
});
