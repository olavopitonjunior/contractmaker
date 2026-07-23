import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordHumanDocEdit } from "../human-doc-edit";

const NOW = new Date("2026-07-23T12:00:00Z");

function makeDeps(recent: { id: string } | null) {
  const findFirst = vi.fn(async () => recent);
  const create = vi.fn(async () => ({ id: "new-id" }));
  const update = vi.fn(async () => ({}));
  return {
    deps: { db: { contractChangeLog: { findFirst, create, update } } as never, now: () => NOW },
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

  it("busca a entry recente por action + janela de coalesce", async () => {
    const { deps, findFirst } = makeDeps(null);
    await recordHumanDocEdit(deps, { contractId: "c1" });
    const where = (findFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.contractId).toBe("c1");
    expect(where.action).toBe("human_doc_edit");
    expect(where.createdAt).toBeDefined();
  });
});
