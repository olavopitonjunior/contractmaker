import { describe, it, expect, vi, beforeEach } from "vitest";

// O setup global mocka `renderContratoHTML` (devolve o JSON dos dados). Aqui
// precisamos do Handlebars DE VERDADE: o ponto do slot é que o conteúdo saia
// renderizado — e o fallback é o switch canônico de `composed-blocks`.
vi.mock("@/lib/render/handlebars", async () =>
  vi.importActual("@/lib/render/handlebars")
);

import {
  CLAUSE_SLOTS,
  detectClauseSlots,
  resolveClauseSlots,
  slotDeclarationComment,
  slotMarkerHandlebars,
  slotTagsFor,
  slotToken,
} from "../clause-slots";
import { CANONICAL_TEMPLATE_SOURCES } from "../canonical-sources.generated";

const FIADOR_DATA = {
  garantia: {
    tipo: "fiador",
    fiador: { tipo_pessoa: "fisica", nome: "João", cpf: "12345678900" },
  },
  locatarios: [{ tipo_pessoa: "fisica", nome: "Maria", cpf: "98765432100" }],
  aluguel: { valor: 2500, dia_vencimento: 5 },
};

const CAUCAO_DATA = {
  garantia: { tipo: "caucao", caucao_meses: 3 },
  locatarios: [{ tipo_pessoa: "fisica", nome: "Maria" }],
};

function dbWith(rows: Array<{ id: string; content: string }>) {
  return { knowledgeItem: { findMany: vi.fn().mockResolvedValue(rows) } };
}

describe("declaração e detecção de slots", () => {
  it("detecta `{{{slot_garantia}}}` (engine handlebars)", () => {
    expect(detectClauseSlots(`<p>x</p>${slotMarkerHandlebars("garantia")}`)).toEqual([
      "garantia",
    ]);
  });

  it("detecta a declaração em comentário (engine google_docs)", () => {
    const source = [
      "<!-- engine=google_docs: a fonte é o Google Doc -->",
      slotDeclarationComment(["garantia"]),
    ].join("\n");
    expect(detectClauseSlots(source)).toEqual(["garantia"]);
  });

  it("detecta `{{slot_garantia}}` com espaços", () => {
    expect(detectClauseSlots("texto {{ slot_garantia }} texto")).toEqual(["garantia"]);
  });

  it("source vazio/nulo não declara nada", () => {
    expect(detectClauseSlots(null)).toEqual([]);
    expect(detectClauseSlots("")).toEqual([]);
    expect(slotDeclarationComment([])).toBe("");
  });

  it("REGRESSÃO: nenhum template canônico declara slot", () => {
    for (const [filename, source] of Object.entries(CANONICAL_TEMPLATE_SOURCES)) {
      expect(detectClauseSlots(source), filename).toEqual([]);
    }
  });

  it("tags são o par slot + opção do formulário", () => {
    expect(slotTagsFor("garantia", "fiador")).toEqual(["slot:garantia", "garantia:fiador"]);
    expect(slotToken("garantia")).toBe("slot_garantia");
  });
});

describe("resolveClauseSlots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("template SEM marcador não consulta o banco e não muda nada", async () => {
    const db = dbWith([]);
    const out = await resolveClauseSlots({
      orgId: "org1",
      templateSource: CANONICAL_TEMPLATE_SOURCES["locacao_residencial_v3.hbs"],
      data: FIADOR_DATA,
      format: "html",
      db,
    });
    expect(out.values).toEqual({});
    expect(out.resolved).toEqual([]);
    expect(db.knowledgeItem.findMany).not.toHaveBeenCalled();
  });

  it("usa a cláusula do acervo cujas tags casam com a garantia do form", async () => {
    const db = dbWith([
      { id: "ki1", content: "<p>Cláusula própria da imobiliária para fiador.</p>" },
    ]);
    const out = await resolveClauseSlots({
      orgId: "org1",
      templateSource: slotMarkerHandlebars("garantia"),
      data: FIADOR_DATA,
      format: "html",
      db,
    });
    expect(out.values.slot_garantia).toContain("Cláusula própria da imobiliária");
    expect(out.resolved[0]).toMatchObject({
      slot: "garantia",
      value: "fiador",
      source: "knowledge",
      knowledgeItemId: "ki1",
    });
    expect(db.knowledgeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org1",
          category: "clause",
          status: "approved",
          tags: { hasEvery: ["slot:garantia", "garantia:fiador"] },
        }),
      })
    );
  });

  it("renderiza a cláusula do acervo com os helpers do contrato", async () => {
    const db = dbWith([
      { id: "ki2", content: "<p>Caução de {{garantia.caucao_meses}} aluguéis.</p>" },
    ]);
    const out = await resolveClauseSlots({
      orgId: "org1",
      templateSource: slotMarkerHandlebars("garantia"),
      data: CAUCAO_DATA,
      format: "html",
      db,
    });
    expect(out.values.slot_garantia).toContain("Caução de 3 aluguéis");
  });

  it("org SEM cláusula com a tag cai na condicional embutida do canônico", async () => {
    const db = dbWith([]);
    const out = await resolveClauseSlots({
      orgId: "org1",
      templateSource: slotMarkerHandlebars("garantia"),
      data: CAUCAO_DATA,
      format: "html",
      db,
    });
    expect(out.resolved[0].source).toBe("fallback");
    expect(out.values.slot_garantia).toContain("a título de caução");
    expect(out.values.slot_garantia).toContain("art. 38 da Lei nº 8.245/91");
  });

  it("form sem garantia informada nem consulta o acervo — vai direto ao fallback", async () => {
    const db = dbWith([{ id: "ki3", content: "<p>não deve ser usada</p>" }]);
    const out = await resolveClauseSlots({
      orgId: "org1",
      templateSource: slotMarkerHandlebars("garantia"),
      data: { locatarios: [{ nome: "Maria" }] },
      format: "html",
      db,
    });
    expect(db.knowledgeItem.findMany).not.toHaveBeenCalled();
    expect(out.resolved[0]).toMatchObject({ value: null, source: "fallback" });
    expect(out.values.slot_garantia).toContain("observado o art. 37");
  });

  it("falha no banco não derruba a geração — cai no fallback", async () => {
    const db = {
      knowledgeItem: { findMany: vi.fn().mockRejectedValue(new Error("pgvector off")) },
    };
    const out = await resolveClauseSlots({
      orgId: "org1",
      templateSource: slotMarkerHandlebars("garantia"),
      data: CAUCAO_DATA,
      format: "html",
      db,
    });
    expect(out.resolved[0].source).toBe("fallback");
    expect(out.values.slot_garantia).toContain("a título de caução");
  });

  it("format=text achata o HTML (o replaceAllText do Docs insere TEXTO)", async () => {
    const db = dbWith([{ id: "ki4", content: "<p>Primeira linha.</p><p>Segunda linha.</p>" }]);
    const out = await resolveClauseSlots({
      orgId: "org1",
      templateSource: slotDeclarationComment(["garantia"]),
      data: FIADOR_DATA,
      format: "text",
      db,
    });
    expect(out.values.slot_garantia).toBe("Primeira linha.\nSegunda linha.");
  });

  it("a opção lida pelo slot é a MESMA que escolhe a variante do template", () => {
    expect(CLAUSE_SLOTS.garantia.selectedValue(FIADOR_DATA)).toBe("fiador");
    expect(CLAUSE_SLOTS.garantia.valueLabel("seguro_fianca")).toBe("Seguro fiança");
  });
});
