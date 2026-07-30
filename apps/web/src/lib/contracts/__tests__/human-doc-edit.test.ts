import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordHumanDocEdit } from "../human-doc-edit";

const NOW = new Date("2026-07-23T12:00:00Z");

function makeDeps(
  recent: { id: string; userId?: string | null } | null,
  resolveEditorUserId?: (contractId: string) => Promise<string | null>
) {
  const findFirst = vi.fn(async () => recent);
  const create = vi.fn(async () => ({ id: "new-id" }));
  const update = vi.fn(async () => ({}));
  return {
    deps: {
      db: { contractChangeLog: { findFirst, create, update } } as never,
      now: () => NOW,
      ...(resolveEditorUserId ? { resolveEditorUserId } : {}),
    },
    findFirst,
    create,
    update,
  };
}

describe("recordHumanDocEdit (sem diff — atribuição)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem entry recente → cria human_doc_edit/source:user", async () => {
    const { deps, create, update } = makeDeps(null);
    const r = await recordHumanDocEdit(deps, { contractId: "c1", details: { channelId: "ch" } });
    expect(r.outcome).toBe("created");
    expect(update).not.toHaveBeenCalled();
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.action).toBe("human_doc_edit");
    expect(data.source).toBe("user");
    expect(data.summary).toContain("manual");
    // sem captura de diff
    expect(data.htmlBefore).toBeUndefined();
    expect(data.htmlAfter).toBeUndefined();
    expect(data.details).toMatchObject({ manual: true, channelId: "ch" });
  });

  it("entry recente → coalesce (só empurra createdAt, não cria)", async () => {
    const { deps, create, update } = makeDeps({ id: "e1" });
    const r = await recordHumanDocEdit(deps, { contractId: "c1" });
    expect(r.outcome).toBe("coalesced");
    expect(r.changeLogId).toBe("e1");
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { createdAt: NOW } });
  });

  it("sem marcador de presença → entry SEM userId e sem flag de atribuição", async () => {
    const { deps, create } = makeDeps(null, async () => null);
    await recordHumanDocEdit(deps, { contractId: "c1" });
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.userId).toBeNull();
    expect(data.details).not.toHaveProperty("attribution");
  });

  it("com marcador → atribui userId e DECLARA a heurística em details", async () => {
    const resolve = vi.fn(async () => "user-7");
    const { deps, create } = makeDeps(null, resolve);
    await recordHumanDocEdit(deps, { contractId: "c1", details: { channelId: "ch" } });
    expect(resolve).toHaveBeenCalledWith("c1");
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.userId).toBe("user-7");
    expect(data.source).toBe("user");
    expect(data.details).toMatchObject({
      manual: true,
      channelId: "ch",
      attribution: "editor_ping",
    });
  });

  it("resolver que lança não derruba o registro (entry sai sem userId)", async () => {
    const { deps, create } = makeDeps(null, async () => {
      throw new Error("redis down");
    });
    const r = await recordHumanDocEdit(deps, { contractId: "c1" });
    expect(r.outcome).toBe("created");
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.userId).toBeNull();
  });

  it("coalesce de entry órfã + marcador → enriquece userId na mesma entry", async () => {
    const { deps, update } = makeDeps({ id: "e1", userId: null }, async () => "user-7");
    await recordHumanDocEdit(deps, { contractId: "c1" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: expect.objectContaining({
        createdAt: NOW,
        userId: "user-7",
        details: expect.objectContaining({ attribution: "editor_ping" }),
      }),
    });
  });

  it("coalesce de entry JÁ atribuída não troca o autor", async () => {
    const { deps, update } = makeDeps({ id: "e1", userId: "user-1" }, async () => "user-9");
    await recordHumanDocEdit(deps, { contractId: "c1" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { createdAt: NOW },
    });
  });

  it("busca a entry recente por action + janela de coalesce", async () => {
    const { deps, findFirst } = makeDeps(null);
    await recordHumanDocEdit(deps, { contractId: "c1" });
    const where = (findFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.contractId).toBe("c1");
    expect(where.action).toBe("human_doc_edit");
    expect(where.createdAt).toBeDefined();
  });
});
