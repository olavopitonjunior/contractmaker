import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordHumanDocEdit } from "../human-doc-edit";

const NOW = new Date("2026-07-23T12:00:00Z");

function makeDeps(over: {
  recent?: { id: string; createdAt: Date; htmlBefore: string | null } | null;
  prevSnapshot?: string | null;
  docText?: string | (() => never);
} = {}) {
  const findFirst = vi.fn(async (args: { where?: { action?: string } }) => {
    // 1ª chamada: busca human_doc_edit recente; 2ª: último snapshot (htmlAfter)
    if (args?.where?.action === "human_doc_edit") return over.recent ?? null;
    return over.prevSnapshot !== undefined ? { htmlAfter: over.prevSnapshot } : null;
  });
  const create = vi.fn(async () => ({ id: "new-id" }));
  const update = vi.fn(async () => ({}));
  const getDocText = vi.fn(async (docId: string) => {
    if (typeof over.docText === "function") return over.docText();
    return over.docText ?? `texto de ${docId}`;
  });
  return {
    deps: { db: { contractChangeLog: { findFirst, create, update } } as never, getDocText, now: () => NOW },
    findFirst,
    create,
    update,
    getDocText,
  };
}

describe("recordHumanDocEdit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem entry recente → cria human_doc_edit com htmlBefore do último snapshot + htmlAfter capturado", async () => {
    const { deps, create, getDocText } = makeDeps({ prevSnapshot: "estado ANTES", docText: "estado DEPOIS" });
    const r = await recordHumanDocEdit(deps, { contractId: "c1", googleDocId: "doc1" });
    expect(r.outcome).toBe("created");
    expect(getDocText).toHaveBeenCalledWith("doc1");
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.action).toBe("human_doc_edit");
    expect(data.source).toBe("user");
    expect(data.htmlBefore).toBe("estado ANTES");
    expect(data.htmlAfter).toBe("estado DEPOIS");
  });

  it("entry recente FORA do throttle → coalesce (update htmlAfter + createdAt, mantém htmlBefore)", async () => {
    const recent = { id: "e1", createdAt: new Date(NOW.getTime() - 60_000), htmlBefore: "início" };
    const { deps, update, create } = makeDeps({ recent, docText: "novo depois" });
    const r = await recordHumanDocEdit(deps, { contractId: "c1", googleDocId: "doc1" });
    expect(r.outcome).toBe("updated");
    expect(create).not.toHaveBeenCalled();
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.htmlAfter).toBe("novo depois");
    expect(data.createdAt).toBe(NOW);
    expect(data.htmlBefore).toBeUndefined(); // não mexe no htmlBefore no coalesce
  });

  it("entry recente DENTRO do throttle → só bump createdAt, NÃO exporta o Doc", async () => {
    const recent = { id: "e1", createdAt: new Date(NOW.getTime() - 10_000), htmlBefore: "início" };
    const { deps, update, getDocText } = makeDeps({ recent });
    const r = await recordHumanDocEdit(deps, { contractId: "c1", googleDocId: "doc1" });
    expect(r.outcome).toBe("throttled");
    expect(getDocText).not.toHaveBeenCalled(); // sem chamada Drive
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { createdAt: NOW } }));
  });

  it("captura falha (Drive erro) → cria mesmo assim, htmlAfter null (atribuição sem diff)", async () => {
    const { deps, create } = makeDeps({
      prevSnapshot: "antes",
      docText: () => {
        throw new Error("drive down");
      },
    });
    const r = await recordHumanDocEdit(deps, { contractId: "c1", googleDocId: "doc1" });
    expect(r.outcome).toBe("created");
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.htmlAfter).toBeNull();
    expect(data.htmlBefore).toBe("antes");
  });

  it("sem googleDocId → não exporta, cria com htmlAfter null", async () => {
    const { deps, create, getDocText } = makeDeps({ prevSnapshot: null });
    const r = await recordHumanDocEdit(deps, { contractId: "c1", googleDocId: null });
    expect(r.outcome).toBe("created");
    expect(getDocText).not.toHaveBeenCalled();
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.htmlAfter).toBeNull();
  });
});
