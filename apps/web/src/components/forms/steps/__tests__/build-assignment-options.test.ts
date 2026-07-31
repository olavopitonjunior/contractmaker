import { describe, expect, it } from "vitest";
import type { DocumentCardData } from "@/components/forms/DocumentCard";
import {
  buildAssignmentOptions,
  slotName,
} from "@/components/forms/steps/build-assignment-options";

/**
 * O bug reportado (2026-07-31) era o dropdown da etapa 0 não oferecer cônjuge
 * nem representante: os grupos existiam, mas atrás de gates que só ficam
 * verdadeiros DEPOIS das etapas de parte (estado_civil casado / tipo_pessoa
 * juridica). Estes testes travam o comportamento novo: com os defaults da
 * etapa 0 os três grupos de sub-slot aparecem.
 */

const NO_DOCS: DocumentCardData[] = [];

/** Defaults reais do SalesFormWizard na etapa 0. */
const STEP0_SNAPSHOT = {
  vendedores: [{ tipo_pessoa: "fisica", nome: "", estado_civil: "" }],
  compradores: [{ tipo_pessoa: "fisica", nome: "", estado_civil: "" }],
};

const labelsOf = (groups: { label: string }[]) => groups.map((g) => g.label);
const valuesOf = (groups: { options: { value: string }[] }[]) =>
  groups.flatMap((g) => g.options.map((o) => o.value));

describe("buildAssignmentOptions — grupos com os defaults da etapa 0", () => {
  const groups = buildAssignmentOptions(STEP0_SNAPSHOT, NO_DOCS);

  it("oferece Cônjuges, Procuradores e Representantes mesmo sem estado civil/PJ", () => {
    expect(labelsOf(groups)).toEqual([
      "Vendedores",
      "Compradores",
      "Cônjuges",
      "Procuradores",
      "Representantes legais",
      "Imóveis",
      "Outros",
    ]);
    const values = valuesOf(groups);
    expect(values).toContain("conjuge_vendedor:0");
    expect(values).toContain("conjuge_comprador:0");
    expect(values).toContain("procurador_vendedor:0");
    expect(values).toContain("procurador_comprador:0");
    expect(values).toContain("representante_vendedor:0");
    expect(values).toContain("representante_comprador:0");
  });

  it("só os kinds pai ganham '+ Novo'", () => {
    const values = valuesOf(groups);
    expect(values).toContain("vendedor:new");
    expect(values).toContain("comprador:new");
    expect(values).toContain("imovel:new");
    expect(values.filter((v) => v.endsWith(":new"))).toHaveLength(3);
  });

  it("sem snapshot nenhum ainda mostra o slot 1 de cada papel", () => {
    const values = valuesOf(buildAssignmentOptions({}, NO_DOCS));
    expect(values).toContain("vendedor:0");
    expect(values).toContain("conjuge_vendedor:0");
    expect(values).toContain("procurador_comprador:0");
  });
});

describe("buildAssignmentOptions — parte PJ", () => {
  const groups = buildAssignmentOptions(
    {
      vendedores: [{ tipo_pessoa: "juridica", razao_social: "Imob LTDA" }],
      compradores: [{ tipo_pessoa: "fisica", nome: "Maria" }],
    },
    NO_DOCS
  );

  it("PJ não tem cônjuge nem procurador (o schema é só de PF)", () => {
    const values = valuesOf(groups);
    expect(values).not.toContain("conjuge_vendedor:0");
    expect(values).not.toContain("procurador_vendedor:0");
    expect(values).toContain("conjuge_comprador:0");
    expect(values).toContain("procurador_comprador:0");
  });

  it("representante continua oferecido pros dois (a PJ-ness pode chegar depois)", () => {
    const values = valuesOf(groups);
    expect(values).toContain("representante_vendedor:0");
    expect(values).toContain("representante_comprador:0");
  });

  it("rótulo usa razão social da PJ e nome da PF", () => {
    const reps = groups.find((g) => g.label === "Representantes legais")!;
    expect(reps.options[0].label).toBe("Representante de Vendedor 1 — Imob LTDA");
    const conjuges = groups.find((g) => g.label === "Cônjuges")!;
    expect(conjuges.options[0].label).toBe("Cônjuge de Comprador 1 — Maria");
  });
});

describe("buildAssignmentOptions — contagem de slots", () => {
  const docOn = (kind: string, index: number): DocumentCardData =>
    ({
      id: `doc-${kind}-${index}`,
      filename: "x.jpg",
      mime: "image/jpeg",
      fileUrl: "/x",
      status: "ready",
      category: "rg",
      fields: { nome_completo: "Pessoa Extraída" },
      confidence: 0.9,
      assignment: { kind, index },
    }) as DocumentCardData;

  it("doc atribuído a um sub-slot alto faz o pai crescer no dropdown", () => {
    const values = valuesOf(
      buildAssignmentOptions(STEP0_SNAPSHOT, [docOn("procurador_vendedor", 1)])
    );
    expect(values).toContain("vendedor:1");
    expect(values).toContain("procurador_vendedor:1");
    expect(values).toContain("conjuge_vendedor:1");
  });

  it("slotName usa o nome do form e, sem ele, o do doc já atribuído", () => {
    expect(
      slotName("vendedor", 0, { vendedores: [{ nome: "João" }] }, NO_DOCS)
    ).toBe("João");
    expect(slotName("vendedor", 0, {}, [docOn("vendedor", 0)])).toBe(
      "Pessoa Extraída"
    );
    expect(slotName("comprador", 0, {}, NO_DOCS)).toBeNull();
  });
});
