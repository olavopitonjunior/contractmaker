import { describe, it, expect, vi } from "vitest";
import {
  checkSlotClauseReadiness,
  expectedSlotValue,
  requiredSlotTags,
  slotClauseGapMessage,
  type SlotClauseDb,
} from "../slot-readiness";
import { slotDeclarationComment } from "../clause-slots";

const COM_SLOT = `<!-- engine=google_docs -->\n${slotDeclarationComment(["garantia"])}`;

function db(rows: Array<{ id: string }>): SlotClauseDb {
  return { knowledgeItem: { findMany: vi.fn().mockResolvedValue(rows) } };
}

describe("expectedSlotValue", () => {
  it("o critério do modelo fixa a opção que o slot vai receber", () => {
    expect(expectedSlotValue("garantia", { garantia: "fiador" })).toBe("fiador");
  });

  it("modelo sem critério de garantia atende qualquer opção", () => {
    expect(expectedSlotValue("garantia", null)).toBeNull();
    expect(expectedSlotValue("garantia", { pessoa: "pj" })).toBeNull();
  });

  it("normaliza o nome legado da garantia — o rename não pode virar buraco", () => {
    expect(expectedSlotValue("garantia", { garantia: "garantia_digital" })).toBe(
      "garantia_onerosa"
    );
  });
});

describe("requiredSlotTags", () => {
  it("com opção fixada, exige o par slot + opção", () => {
    expect(requiredSlotTags("garantia", "caucao")).toEqual([
      "slot:garantia",
      "garantia:caucao",
    ]);
  });

  it("sem opção, basta existir cláusula do slot", () => {
    expect(requiredSlotTags("garantia", null)).toEqual(["slot:garantia"]);
  });
});

describe("checkSlotClauseReadiness", () => {
  it("modelo sem slot está pronto e não consulta o acervo", async () => {
    const client = db([]);
    const readiness = await checkSlotClauseReadiness({
      orgId: "org-1",
      handlebarsSource: "<p>modelo comum</p>",
      matchCriteria: null,
      db: client,
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.slots).toEqual([]);
    expect(client.knowledgeItem.findMany).not.toHaveBeenCalled();
  });

  it("slot sem cláusula aprovada do tenant vira lacuna", async () => {
    const readiness = await checkSlotClauseReadiness({
      orgId: "org-1",
      handlebarsSource: COM_SLOT,
      matchCriteria: { garantia: "seguro_fianca" },
      db: db([]),
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.gaps).toHaveLength(1);
    expect(readiness.gaps[0]).toMatchObject({
      slot: "garantia",
      value: "seguro_fianca",
      tags: ["slot:garantia", "garantia:seguro_fianca"],
    });
    expect(readiness.gaps[0].label).toContain("Seguro fiança");
  });

  it("cláusula aprovada do tenant libera a ativação", async () => {
    const readiness = await checkSlotClauseReadiness({
      orgId: "org-1",
      handlebarsSource: COM_SLOT,
      matchCriteria: { garantia: "fiador" },
      db: db([{ id: "kb-1" }]),
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.gaps).toEqual([]);
  });

  it("a consulta é escopada no acervo DA IMOBILIÁRIA — o da plataforma não conta", async () => {
    const client = db([]);
    await checkSlotClauseReadiness({
      orgId: "org-1",
      handlebarsSource: COM_SLOT,
      matchCriteria: null,
      db: client,
    });

    const where = (client.knowledgeItem.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0][0].where;
    // O fallback da plataforma (orgId null) salva a geração de quebrar, mas o
    // texto que sai é o NOSSO — não é o que o operador acha que está ativando.
    expect(where.orgId).toBe("org-1");
    expect(where.category).toBe("clause");
    expect(where.status).toBe("approved");
    expect(where.parentId).toBeNull();
  });
});

describe("slotClauseGapMessage", () => {
  it("diz o efeito concreto, não a regra", () => {
    const msg = slotClauseGapMessage([
      {
        slot: "garantia",
        value: "fiador",
        tags: ["slot:garantia", "garantia:fiador"],
        label: "Cláusula de garantia · Fiador",
      },
    ]);
    expect(msg).toContain("texto padrão da plataforma");
    expect(msg).toContain("cláusula de garantia · fiador");
    expect(msg).toContain("ative mesmo assim");
  });
});
