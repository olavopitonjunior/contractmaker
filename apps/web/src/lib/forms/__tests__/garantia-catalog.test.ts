import { describe, it, expect } from "vitest";
import {
  DEFAULT_GARANTIA_OPTIONS,
  buildGarantiaChoices,
  findGarantiaChoice,
  garantiaChoiceValue,
  selectedGarantiaChoiceValue,
  type GarantiaOptionLike,
} from "../garantia-catalog";
import { GARANTIA_TIPOS } from "@/lib/contracts/template-category";

const labels = (opts?: readonly GarantiaOptionLike[]) =>
  buildGarantiaChoices(opts).map((c) => c.label);

describe("buildGarantiaChoices — catálogo vazio", () => {
  it("oferece as 7 modalidades canônicas, incluindo `propria`", () => {
    const choices = buildGarantiaChoices([]);
    const tipos = choices.map((c) => c.tipo);
    for (const t of GARANTIA_TIPOS) expect(tipos, t).toContain(t);
    // Gap antigo da UI: "garantia própria" existia no schema e não no select.
    expect(labels([])).toContain("Garantia própria");
  });

  it("sem opção nenhuma não inventa 'outro garantidor'", () => {
    expect(buildGarantiaChoices([]).some((c) => c.isOutro)).toBe(false);
  });
});

describe("buildGarantiaChoices — defaults da plataforma", () => {
  const choices = buildGarantiaChoices(DEFAULT_GARANTIA_OPTIONS);

  it("cada seguradora vira UMA escolha tipo + garantidor", () => {
    const ls = choices.map((c) => c.label);
    expect(ls).toContain("Seguro fiança — Porto Seguro");
    expect(ls).toContain("Seguro fiança — Tokio Marine");
    expect(ls).toContain("Seguro fiança — Pottencial");
    expect(ls).toContain("Seguro fiança — Too");
  });

  it("escolher preenche tipo E garantidor", () => {
    const porto = choices.find((c) => c.provider === "Porto Seguro");
    expect(porto?.tipo).toBe("seguro_fianca");
    expect(porto?.value).toBe(garantiaChoiceValue("seguro_fianca", "Porto Seguro"));
  });

  it("tipo com garantidores ganha o escape hatch 'outro garantidor…'", () => {
    const outro = choices.find((c) => c.tipo === "seguro_fianca" && c.isOutro);
    expect(outro).toBeTruthy();
    expect(outro?.provider).toBe("");
  });

  it("modalidades sem garantidor continuam disponíveis", () => {
    const ls = choices.map((c) => c.label);
    expect(ls).toContain("Fiador");
    expect(ls).toContain("Caução");
    expect(ls).toContain("Sem garantia");
    expect(ls).toContain("Garantia própria");
  });

  it("as opções do mesmo tipo ficam adjacentes (agrupamento visual)", () => {
    const idx = choices
      .map((c, i) => ({ tipo: c.tipo, i }))
      .filter((x) => x.tipo === "seguro_fianca")
      .map((x) => x.i);
    expect(idx).toEqual(idx.map((_, k) => idx[0] + k));
  });
});

describe("buildGarantiaChoices — catálogo da org", () => {
  const custom: GarantiaOptionLike[] = [
    { id: "1", tipo: "seguro_fianca", provider: "Pottencial", position: 0 },
    { id: "2", tipo: "seguro_fianca", provider: "Loft", position: 1, active: false },
    { id: "3", tipo: "titulo_capitalizacao", provider: "Porto Capitalização", position: 2 },
    { id: "4", tipo: "fiador", provider: "", label: "Fiador (com imóvel próprio)" },
  ];

  it("desativada não aparece", () => {
    expect(labels(custom)).not.toContain("Seguro fiança — Loft");
    expect(labels(custom)).toContain("Seguro fiança — Pottencial");
  });

  it("respeita label customizado da modalidade direta", () => {
    expect(labels(custom)).toContain("Fiador (com imóvel próprio)");
    expect(labels(custom)).not.toContain("Fiador");
  });

  it("título de capitalização também aceita garantidor", () => {
    expect(labels(custom)).toContain("Título de capitalização — Porto Capitalização");
  });

  it("ignora tipo desconhecido em vez de explodir", () => {
    const ls = labels([{ tipo: "penhor_de_gado", provider: "X" }]);
    expect(ls).not.toContain("undefined — X");
    expect(ls).toContain("Fiador");
  });

  it("não duplica o mesmo par tipo × garantidor", () => {
    const ls = labels([
      { tipo: "seguro_fianca", provider: "Porto Seguro" },
      { tipo: "seguro_fianca", provider: "Porto Seguro" },
    ]);
    expect(ls.filter((l) => l === "Seguro fiança — Porto Seguro")).toHaveLength(1);
  });
});

describe("selectedGarantiaChoiceValue", () => {
  const choices = buildGarantiaChoices(DEFAULT_GARANTIA_OPTIONS);

  it("casa o que o formulário já gravou", () => {
    const v = selectedGarantiaChoiceValue(choices, "seguro_fianca", "Porto Seguro");
    expect(findGarantiaChoice(choices, v)?.provider).toBe("Porto Seguro");
  });

  it("garantidor fora do catálogo cai no escape hatch (sem perder o texto)", () => {
    const v = selectedGarantiaChoiceValue(choices, "seguro_fianca", "Seguradora XPTO");
    expect(findGarantiaChoice(choices, v)?.isOutro).toBe(true);
  });

  it("modalidade sem garantidor casa a opção direta", () => {
    const v = selectedGarantiaChoiceValue(choices, "fiador", "");
    expect(findGarantiaChoice(choices, v)?.tipo).toBe("fiador");
    expect(findGarantiaChoice(choices, v)?.isOutro).toBe(false);
  });

  it("form legado sem garantia definida cai em caução (default do schema)", () => {
    const v = selectedGarantiaChoiceValue(choices, undefined, undefined);
    expect(findGarantiaChoice(choices, v)?.tipo).toBe("caucao");
  });
});
