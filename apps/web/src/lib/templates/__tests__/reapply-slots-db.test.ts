import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A parte que ESCREVE: escopo de org, modelo ativo, merge de `draftReport.slots`
 * sem duplicar, e a fonte do modelo preservando o que não é slot.
 */
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const runsMock = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    contractTemplate: {
      findFirst: (...a: unknown[]) => findFirstMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
    ingestionRun: { findMany: (...a: unknown[]) => runsMock(...a) },
  },
}));
const applyMock = vi.fn();
vi.mock("../apply-clause-slot", () => ({
  applyClauseSlotToDoc: (...a: unknown[]) => applyMock(...a),
}));

import { declareSlots, reapplySlotsForTemplate, SlotReapplyError } from "../reapply-slots";
import { GOOGLE_DOCS_SOURCE_HEADER } from "../validate-gdoc";

const run = (templateId: string, blocks: string[]) => ({
  libraryPlan: null,
  planReviewed: {
    version: 1,
    templates: [
      {
        sourceItemId: "item-1",
        name: "M",
        modalidade: "locacao",
        matchCriteria: { garantia: "caucao" },
        rationale: "t",
        slotBlocks: { garantia: blocks },
      },
    ],
    clauses: [],
    discards: [],
    issues: [],
    confidence: 0.9,
  },
  report: {
    execution: { version: 1, templates: [{ sourceItemId: "item-1", status: "created", templateId }], clauses: [], discards: [], issues: [] },
  },
});

const template = (over: Record<string, unknown> = {}) => ({
  id: "tpl-1",
  engine: "google_docs",
  status: "draft",
  googleTemplateDocId: "doc-1",
  draftReport: { slots: [{ slot: "garantia", applied: false, token: null, removed: 0, issues: [{ paragraph: "8.1…", reason: "replace-noop" }] }], pii: { blocked: false } },
  handlebarsSource: GOOGLE_DOCS_SOURCE_HEADER,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  updateMock.mockResolvedValue({});
});

describe("reapplySlotsForTemplate", () => {
  it("modelo de outra org (ou inexistente) → TEMPLATE_NOT_FOUND, sem escrever", async () => {
    findFirstMock.mockResolvedValue(null);
    await expect(reapplySlotsForTemplate({ templateId: "tpl-1", orgId: "org-x" })).rejects.toMatchObject({
      code: "TEMPLATE_NOT_FOUND",
    });
    expect(findFirstMock.mock.calls[0][0].where).toEqual({ id: "tpl-1", orgId: "org-x" });
    expect(applyMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("modelo ativo → TEMPLATE_ACTIVE, sem escrever", async () => {
    findFirstMock.mockResolvedValue(template({ status: "active" }));
    await expect(reapplySlotsForTemplate({ templateId: "tpl-1", orgId: "org-1" })).rejects.toBeInstanceOf(
      SlotReapplyError
    );
    expect(applyMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("sem lote que o criou → PLAN_MISSING", async () => {
    findFirstMock.mockResolvedValue(template());
    runsMock.mockResolvedValue([run("outro-tpl", ["x"])]);
    await expect(reapplySlotsForTemplate({ templateId: "tpl-1", orgId: "org-1" })).rejects.toMatchObject({
      code: "PLAN_MISSING",
    });
    expect(runsMock.mock.calls[0][0].where).toEqual({ orgId: "org-1" });
  });

  it("slot aplicado: substitui a entrada antiga em draftReport.slots (não duplica) e declara o slot", async () => {
    findFirstMock.mockResolvedValue(template());
    runsMock.mockResolvedValue([run("tpl-1", ["8.1. Como garantia, caução."])]);
    applyMock.mockResolvedValue({ slot: "garantia", applied: true, token: "{{slot_garantia}}", removed: 0, issues: [] });

    const out = await reapplySlotsForTemplate({ templateId: "tpl-1", orgId: "org-1" });

    expect(applyMock).toHaveBeenCalledWith({ docId: "doc-1", slot: "garantia", paragraphs: ["8.1. Como garantia, caução."] });
    expect(out.declared).toEqual(["garantia"]);
    const data = updateMock.mock.calls[0][0].data;
    expect(data.draftReport.slots).toEqual([
      { slot: "garantia", applied: true, token: "{{slot_garantia}}", removed: 0, issues: [] },
    ]);
    expect(data.draftReport.pii).toEqual({ blocked: false });
    expect(data.handlebarsSource).toContain("{{slot_garantia}}");
  });

  it("slot que não abriu de novo: relatório atualizado, fonte do modelo intocada", async () => {
    findFirstMock.mockResolvedValue(template());
    runsMock.mockResolvedValue([run("tpl-1", ["8.1. Como garantia, caução."])]);
    applyMock.mockResolvedValue({ slot: "garantia", applied: false, token: null, removed: 0, issues: [{ paragraph: "8.1…", reason: "not-found" }] });

    await reapplySlotsForTemplate({ templateId: "tpl-1", orgId: "org-1" });

    const data = updateMock.mock.calls[0][0].data;
    expect(data.draftReport.slots).toHaveLength(1);
    expect(data.draftReport.slots[0].issues[0].reason).toBe("not-found");
    expect(data.handlebarsSource).toBeUndefined();
  });
});

describe("declareSlots", () => {
  it("cabeçalho + declaração, e o resto do que estava na fonte sobrevive", () => {
    const antes = [GOOGLE_DOCS_SOURCE_HEADER, "<!-- nota do operador -->", "<!-- slots: {{slot_garantia}} -->"].join("\n");
    const depois = declareSlots(antes, ["garantia"]);
    const linhas = depois.split("\n");
    expect(linhas[0]).toBe(GOOGLE_DOCS_SOURCE_HEADER);
    expect(linhas[1]).toBe("<!-- slots: {{slot_garantia}} -->");
    expect(linhas).toContain("<!-- nota do operador -->");
    expect(linhas.filter((l) => l.includes("slots:"))).toHaveLength(1);
  });

  it("fonte vazia ou só cabeçalho", () => {
    expect(declareSlots(null, ["garantia"]).split("\n")).toEqual([
      GOOGLE_DOCS_SOURCE_HEADER,
      "<!-- slots: {{slot_garantia}} -->",
    ]);
  });
});
