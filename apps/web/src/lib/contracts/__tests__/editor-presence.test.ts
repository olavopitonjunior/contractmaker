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
  markContractEditorPresence,
  getRecentContractEditor,
  __resetEditorPresenceClientForTests,
} from "../editor-presence";

const OLD_ENV = { ...process.env };

function withRedis() {
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
  delete process.env.REDIS_KEY_PREFIX;
  __resetEditorPresenceClientForTests();
}

/** get(amb) e get(editor) — a ordem dos gets é [amb, editor]. */
function mockKeys(opts: { ambiguous?: boolean; editor?: string | null }) {
  mockGet.mockImplementation(async (k: string) =>
    k.includes("-amb:") ? (opts.ambiguous ? "1" : null) : (opts.editor ?? null)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue("OK");
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  __resetEditorPresenceClientForTests();
});

describe("editor-presence", () => {
  it("sem Redis configurado → mark é no-op e leitura devolve null", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetEditorPresenceClientForTests();

    await markContractEditorPresence("c1", "u1");
    expect(mockSet).not.toHaveBeenCalled();
    expect(await getRecentContractEditor("c1")).toBeNull();
  });

  it("mark grava o userId com TTL na chave do contrato", async () => {
    withRedis();
    mockKeys({ editor: null });
    await markContractEditorPresence("c1", "u1");
    expect(mockSet).toHaveBeenCalledWith(
      "contract-editor:c1",
      "u1",
      expect.objectContaining({ ex: expect.any(Number) })
    );
  });

  it("mesmo usuário pingando de novo NÃO marca ambíguo", async () => {
    withRedis();
    mockKeys({ editor: "u1" });
    await markContractEditorPresence("c1", "u1");
    const ambSets = mockSet.mock.calls.filter((c) =>
      String(c[0]).includes("-amb:")
    );
    expect(ambSets).toHaveLength(0);
  });

  it("segundo usuário na janela → marca ambíguo", async () => {
    withRedis();
    mockKeys({ editor: "u1" });
    await markContractEditorPresence("c1", "u2");
    expect(mockSet).toHaveBeenCalledWith(
      "contract-editor-amb:c1",
      "1",
      expect.objectContaining({ ex: expect.any(Number) })
    );
    expect(mockSet).toHaveBeenCalledWith(
      "contract-editor:c1",
      "u2",
      expect.objectContaining({ ex: expect.any(Number) })
    );
  });

  it("leitura devolve o userId quando há marcador e não há ambiguidade", async () => {
    withRedis();
    mockKeys({ editor: "u1" });
    expect(await getRecentContractEditor("c1")).toBe("u1");
  });

  it("leitura devolve null quando ambíguo (dois editores) — não chuta autor", async () => {
    withRedis();
    mockKeys({ ambiguous: true, editor: "u2" });
    expect(await getRecentContractEditor("c1")).toBeNull();
  });

  it("leitura devolve null sem marcador", async () => {
    withRedis();
    mockKeys({ editor: null });
    expect(await getRecentContractEditor("c1")).toBeNull();
  });

  it("contractId vazio → no-op nos dois sentidos", async () => {
    withRedis();
    await markContractEditorPresence("", "u1");
    expect(await getRecentContractEditor("")).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("respeita REDIS_KEY_PREFIX", async () => {
    withRedis();
    process.env.REDIS_KEY_PREFIX = "staging:";
    __resetEditorPresenceClientForTests();
    mockKeys({ editor: null });
    await getRecentContractEditor("c1");
    expect(mockGet).toHaveBeenCalledWith("staging:contract-editor:c1");
    expect(mockGet).toHaveBeenCalledWith("staging:contract-editor-amb:c1");
  });

  it("Redis lançando não propaga erro", async () => {
    withRedis();
    mockGet.mockRejectedValue(new Error("down"));
    mockSet.mockRejectedValue(new Error("down"));
    await expect(markContractEditorPresence("c1", "u1")).resolves.toBeUndefined();
    await expect(getRecentContractEditor("c1")).resolves.toBeNull();
  });
});
