import { describe, it, expect } from "vitest";
import { plannedSlotBlocksFor, requestedSlotsOf } from "../reapply-slots";

/**
 * A parte PURA da reaplicação: achar, entre os runs da org, o plano que criou
 * o modelo — pela linha `execution.templates[].templateId` — e devolver os
 * `slotBlocks` do `PlannedTemplate` correspondente.
 */
const plan = (templates: unknown[]) => ({
  version: 1,
  templates,
  clauses: [],
  discards: [],
  issues: [],
  confidence: 0.9,
});
const execution = (templates: unknown[]) => ({
  execution: { version: 1, templates, clauses: [], discards: [], issues: [] },
});
const planned = (sourceItemId: string, slotBlocks?: Record<string, string[]>) => ({
  sourceItemId,
  name: "Modelo",
  modalidade: "locacao",
  matchCriteria: { garantia: "caucao" },
  rationale: "teste",
  ...(slotBlocks ? { slotBlocks } : {}),
});

describe("plannedSlotBlocksFor", () => {
  it("acha o plano pelo templateId da execução e devolve os blocos do item certo", () => {
    const runs = [
      {
        libraryPlan: plan([planned("item-a", { garantia: ["Bloco do rascunho"] })]),
        planReviewed: plan([
          planned("item-a", { garantia: ["8.1. Como garantia, caução."] }),
          planned("item-b", { garantia: ["Outro bloco"] }),
        ]),
        report: execution([
          { sourceItemId: "item-b", status: "created", templateId: "tpl-b" },
          { sourceItemId: "item-a", status: "created", templateId: "tpl-a" },
        ]),
      },
    ];
    // O plano REVISADO vale, não o rascunho do planner.
    expect(plannedSlotBlocksFor(runs, "tpl-a")).toEqual({ garantia: ["8.1. Como garantia, caução."] });
    expect(plannedSlotBlocksFor(runs, "tpl-b")).toEqual({ garantia: ["Outro bloco"] });
  });

  it("cai no libraryPlan quando não houve revisão", () => {
    const runs = [
      {
        libraryPlan: plan([planned("item-a", { garantia: ["Bloco"] })]),
        planReviewed: null,
        report: execution([{ sourceItemId: "item-a", status: "created", templateId: "tpl-a" }]),
      },
    ];
    expect(plannedSlotBlocksFor(runs, "tpl-a")).toEqual({ garantia: ["Bloco"] });
  });

  it("modelo sem run (envio avulso) → null; modelo planejado sem slots → {}", () => {
    const runs = [
      {
        libraryPlan: plan([planned("item-a")]),
        planReviewed: null,
        report: execution([{ sourceItemId: "item-a", status: "created", templateId: "tpl-a" }]),
      },
    ];
    expect(plannedSlotBlocksFor(runs, "tpl-x")).toBeNull();
    expect(plannedSlotBlocksFor(runs, "tpl-a")).toEqual({});
    expect(requestedSlotsOf({})).toEqual([]);
    expect(requestedSlotsOf({ garantia: [] })).toEqual([]);
    expect(requestedSlotsOf({ garantia: ["x"] })).toEqual(["garantia"]);
  });

  it("run sem relatório de execução ou com plano em formato desconhecido é ignorado", () => {
    const runs = [
      { libraryPlan: { version: 99 }, planReviewed: null, report: null },
      {
        libraryPlan: null,
        planReviewed: plan([planned("item-a", { garantia: ["Bloco"] })]),
        report: execution([{ sourceItemId: "item-a", status: "created", templateId: "tpl-a" }]),
      },
    ];
    expect(plannedSlotBlocksFor(runs, "tpl-a")).toEqual({ garantia: ["Bloco"] });
  });
});
