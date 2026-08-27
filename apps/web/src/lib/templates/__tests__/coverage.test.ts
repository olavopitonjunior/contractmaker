import { describe, it, expect } from "vitest";
import {
  computeGarantiaCoverage,
  computeTemplateCoverage,
  isOwnTemplate,
  REQUIRED_KIT_MODALIDADES,
  type CoverageTemplateLite,
} from "../coverage";

function tpl(over: Partial<CoverageTemplateLite>): CoverageTemplateLite {
  return {
    id: "t1",
    name: "Locação Residencial",
    modalidade: "locacao",
    status: "active",
    engine: "handlebars",
    sourceHash: null,
    ...over,
  };
}

describe("isOwnTemplate", () => {
  it("modelo ingerido da imobiliária (engine google_docs) é 'seu modelo'", () => {
    expect(isOwnTemplate(tpl({ engine: "google_docs" }))).toBe(true);
  });

  it("template com sourceHash é 'seu modelo' (veio de um DOCX)", () => {
    expect(isOwnTemplate(tpl({ sourceHash: "abc" }))).toBe(true);
  });

  it("canônico intocado (nome do catálogo, engine handlebars) NÃO é 'seu modelo'", () => {
    expect(isOwnTemplate(tpl({ name: "Locação Residencial" }))).toBe(false);
  });

  it("template criado do zero (nome próprio) é 'seu modelo'", () => {
    expect(isOwnTemplate(tpl({ name: "Locação — padrão da casa" }))).toBe(true);
  });
});

describe("computeTemplateCoverage", () => {
  it("o representante da linha é o PADRÃO da modalidade, não o primeiro criado", () => {
    // O caso real da Ativa: painel exibia o Seguro-Fiança (criado antes)
    // enquanto o padrão era o Fiador — o operador trocou o padrão e a tela
    // pareceu não ter mudado nada.
    const report = computeTemplateCoverage({
      modules: ["locacao"],
      templates: [
        {
          id: "t1",
          name: "Contrato — Seguro-Fiança",
          modalidade: "locacao",
          status: "active",
          engine: "google_docs",
          isDefault: false,
        },
        {
          id: "t2",
          name: "Contrato — Fiador (Administrado)",
          modalidade: "locacao",
          status: "active",
          engine: "google_docs",
          isDefault: true,
        },
      ],
    });
    const row = report.rows.find((r) => r.modalidade === "locacao");
    expect(row?.templateName).toBe("Contrato — Fiador (Administrado)");
  });

  it("org só-locação não é cobrada por modelos de venda", () => {
    const report = computeTemplateCoverage({ modules: ["locacao"], templates: [] });
    const modalidades = report.rows.map((r) => r.modalidade);
    expect(modalidades).not.toContain("a_vista");
    expect(modalidades).not.toContain("financiamento");
    expect(modalidades).not.toContain("proposta_venda");
    expect(modalidades).toContain("locacao");
    expect(modalidades).toContain("proposta_locacao_residencial");
  });

  it("org só-locação: o kit exigido é só a parte de locação", () => {
    const report = computeTemplateCoverage({ modules: ["locacao"], templates: [] });
    expect(report.rows.filter((r) => r.required).map((r) => r.modalidade)).toEqual([
      "proposta_locacao_residencial",
      "locacao",
    ]);
  });

  it("org com os dois módulos exige o kit mínimo completo, nessa ordem", () => {
    const report = computeTemplateCoverage({
      modules: ["vendas", "locacao"],
      templates: [],
    });
    expect(report.rows.filter((r) => r.required).map((r) => r.modalidade)).toEqual(
      REQUIRED_KIT_MODALIDADES
    );
    expect(report.requiredDone).toBe(0);
    expect(report.kitComplete).toBe(false);
    expect(report.rows.every((r) => r.state === "missing")).toBe(true);
  });

  it("ADM e locação comercial são OPCIONAIS", () => {
    const report = computeTemplateCoverage({ modules: ["locacao"], templates: [] });
    const optional = report.rows.filter((r) => !r.required).map((r) => r.modalidade);
    expect(optional).toContain("administracao_locacao");
    expect(optional).toContain("locacao_comercial");
  });

  it("canônico ativo conta como coberto, mas fica marcado como do sistema", () => {
    const report = computeTemplateCoverage({
      modules: ["locacao"],
      templates: [
        tpl({ id: "c1", modalidade: "locacao", name: "Locação Residencial" }),
        tpl({
          id: "c2",
          modalidade: "proposta_locacao_residencial",
          name: "Proposta de Locação Residencial",
        }),
      ],
    });
    expect(report.kitComplete).toBe(true);
    expect(report.rows.find((r) => r.modalidade === "locacao")?.state).toBe("canonical");
  });

  it("modelo da imobiliária vence o canônico na mesma modalidade", () => {
    const report = computeTemplateCoverage({
      modules: ["locacao"],
      templates: [
        tpl({ id: "c1", modalidade: "locacao", name: "Locação Residencial" }),
        tpl({
          id: "own",
          modalidade: "locacao",
          name: "Locação RE/MAX",
          engine: "google_docs",
        }),
      ],
    });
    const row = report.rows.find((r) => r.modalidade === "locacao");
    expect(row?.state).toBe("own");
    expect(row?.templateId).toBe("own");
  });

  it("template draft/arquivado não cobre nada — a geração só enxerga ativos", () => {
    const report = computeTemplateCoverage({
      modules: ["locacao"],
      templates: [
        tpl({ id: "d1", modalidade: "locacao", status: "draft", engine: "google_docs" }),
      ],
    });
    expect(report.rows.find((r) => r.modalidade === "locacao")?.state).toBe("missing");
  });

  it("org sem módulo habilitado não tem linha nenhuma", () => {
    const report = computeTemplateCoverage({ modules: [], templates: [] });
    expect(report.rows).toHaveLength(0);
    expect(report.kitComplete).toBe(true);
  });
});

describe("computeGarantiaCoverage", () => {
  it("só entram as modalidades em que a garantia decide o modelo", () => {
    const report = computeGarantiaCoverage({
      modules: ["vendas", "locacao"],
      templates: [],
    });
    const modalidades = report.rows.map((r) => r.modalidade);
    expect(modalidades).toContain("locacao");
    expect(modalidades).toContain("locacao_comercial");
    expect(modalidades).toContain("proposta_locacao_residencial");
    // Venda não tem garantia locatícia — a matriz não inventa buraco lá.
    expect(modalidades).not.toContain("a_vista");
    expect(modalidades).not.toContain("proposta_venda");
  });

  it("distingue o modelo ativo do rascunho recém-ingerido", () => {
    const report = computeGarantiaCoverage({
      modules: ["locacao"],
      templates: [
        tpl({
          id: "ativo",
          modalidade: "locacao",
          status: "active",
          matchCriteria: { garantia: "fiador" },
        }),
        tpl({
          id: "rascunho",
          modalidade: "locacao",
          status: "draft",
          matchCriteria: { garantia: "caucao" },
        }),
      ],
    });
    const row = report.rows.find((r) => r.modalidade === "locacao")!;
    expect(row.cells.find((c) => c.garantia === "fiador")!.state).toBe("active");
    expect(row.cells.find((c) => c.garantia === "caucao")!.state).toBe("draft");
    expect(row.cells.find((c) => c.garantia === "seguro_fianca")!.state).toBe("missing");
  });

  it("arquivado não cobre célula nenhuma", () => {
    const report = computeGarantiaCoverage({
      modules: ["locacao"],
      templates: [
        tpl({
          id: "velho",
          modalidade: "locacao",
          status: "archived",
          matchCriteria: { garantia: "fiador" },
        }),
      ],
    });
    const row = report.rows.find((r) => r.modalidade === "locacao")!;
    expect(row.cells.every((c) => c.state === "missing")).toBe(true);
  });

  it("modelo sem critério de garantia não finge cobrir as sete opções", () => {
    const report = computeGarantiaCoverage({
      modules: ["locacao"],
      templates: [tpl({ id: "generico", modalidade: "locacao", matchCriteria: null })],
    });
    const row = report.rows.find((r) => r.modalidade === "locacao")!;
    expect(row.genericState).toBe("active");
    expect(row.cells.every((c) => c.state === "missing")).toBe(true);
  });

  it("buraco só é buraco onde a imobiliária já opera", () => {
    const vazio = computeGarantiaCoverage({ modules: ["locacao"], templates: [] });
    expect(vazio.gaps).toHaveLength(0);

    const comeco = computeGarantiaCoverage({
      modules: ["locacao"],
      templates: [
        tpl({
          id: "t1",
          modalidade: "locacao",
          matchCriteria: { garantia: "fiador" },
        }),
      ],
    });
    expect(comeco.gaps.length).toBe(vazio.garantias.length - 1);
    expect(comeco.gaps.every((g) => g.modalidade === "locacao")).toBe(true);
  });
});
