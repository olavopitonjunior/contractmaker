import { describe, it, expect } from "vitest";
import {
  IDENTITY_TAG_PREFIXES,
  DESCRIPTIVE_TAG_PREFIXES,
  DESCRIPTIVE_VOCABULARY,
  isIdentityTag,
  isDescriptiveTag,
  isCanonicalTag,
  areTagsFrozen,
  normalizeDescriptiveTag,
  mergeDescriptiveTags,
  descriptiveVocabularyFor,
  parseFacet,
} from "@/lib/clauses/tag-vocabulary";

describe("camadas do vocabulário", () => {
  it("as tags de identidade cobrem os prefixos que a geração casa", () => {
    // Se um slot novo entrar em CLAUSE_SLOT_KEYS, seu prefixo de valor tem que
    // aparecer aqui sozinho — é o que impede o classificador de atribuí-lo.
    expect(IDENTITY_TAG_PREFIXES).toContain("slot:");
    expect(IDENTITY_TAG_PREFIXES).toContain("provider:");
    expect(IDENTITY_TAG_PREFIXES).toContain("cobertura:");
    expect(IDENTITY_TAG_PREFIXES).toContain("garantia:");
  });

  it("nenhuma tag descritiva colide com prefixo de identidade", () => {
    // Colisão aqui significaria a IA conseguindo escrever uma tag que amarra a
    // seleção de cláusula na geração de contrato.
    for (const def of DESCRIPTIVE_VOCABULARY) {
      expect(isIdentityTag(def.tag), `${def.tag} colide com identidade`).toBe(false);
    }
  });

  it("todo prefixo descritivo é distinto dos de identidade", () => {
    for (const p of DESCRIPTIVE_TAG_PREFIXES) {
      expect(IDENTITY_TAG_PREFIXES).not.toContain(p);
    }
  });

  it("classifica identidade, descritiva e livre", () => {
    expect(isIdentityTag("slot:garantia")).toBe(true);
    expect(isIdentityTag("garantia:fiador")).toBe(true);
    expect(isDescriptiveTag("tema:vistoria")).toBe(true);
    expect(isDescriptiveTag("tema:inexistente")).toBe(false);
    expect(isCanonicalTag("despesas ordinarias")).toBe(false);
  });

  it("parseFacet separa prefixo e valor, e devolve null em tag livre", () => {
    expect(parseFacet("tema:vistoria")).toEqual({ prefix: "tema:", value: "vistoria" });
    expect(parseFacet("provider:porto_seguro")).toEqual({
      prefix: "provider:",
      value: "porto_seguro",
    });
    expect(parseFacet("arras")).toBeNull();
  });
});

describe("normalizeDescriptiveTag", () => {
  it("é idempotente sobre todo o vocabulário", () => {
    // Um TagDef que não sobrevive à própria normalização produziria duplicata
    // silenciosa no merge.
    for (const def of DESCRIPTIVE_VOCABULARY) {
      expect(normalizeDescriptiveTag(def.tag), def.tag).toBe(def.tag);
    }
  });

  it("usa hífen, minúsculas e remove acento, preservando o prefixo", () => {
    expect(normalizeDescriptiveTag("tema:Rescisão Antecipada")).toBe(
      "tema:rescisao-antecipada"
    );
    expect(normalizeDescriptiveTag("  Despesas Ordinárias ")).toBe("despesas-ordinarias");
  });

  it("NÃO toca tag de identidade — provider usa _ de propósito", () => {
    expect(normalizeDescriptiveTag("provider:porto_seguro")).toBe("provider:porto_seguro");
    expect(normalizeDescriptiveTag("slot:garantia")).toBe("slot:garantia");
  });
});

describe("areTagsFrozen", () => {
  it("congela por origem de identidade", () => {
    expect(areTagsFrozen({ source: "seed_curado", tags: [] })).toBe(true);
    expect(areTagsFrozen({ source: "consolidacao_modelos", tags: [] })).toBe(true);
  });

  it("congela por tag de identidade mesmo quando a origem se perdeu", () => {
    expect(areTagsFrozen({ source: "manual", tags: ["slot:garantia"] })).toBe(true);
    expect(areTagsFrozen({ source: null, tags: ["garantia:fiador"] })).toBe(true);
  });

  it("não congela cláusula manual comum", () => {
    expect(areTagsFrozen({ source: "manual", tags: ["locacao"] })).toBe(false);
  });
});

describe("mergeDescriptiveTags", () => {
  it("NÃO altera tags congeladas — acrescentar já quebraria a reingestão", () => {
    // A identidade de seed_curado/consolidacao é o CONJUNTO EXATO: acrescentar
    // uma tag faz sameTagSet deixar de casar e a reingestão duplica a cláusula.
    const current = ["slot:garantia", "garantia:caucao"];
    expect(mergeDescriptiveTags(current, ["tema:garantia"], { frozen: true })).toBeNull();
  });

  it("acrescenta só descritivas conhecidas, sem duplicar", () => {
    const out = mergeDescriptiveTags(
      ["locacao"],
      ["tema:vistoria", "tema:vistoria", "lei:8245-91"],
      { frozen: false }
    );
    expect(out).toEqual(["locacao", "tema:vistoria", "lei:8245-91"]);
  });

  it("descarta proposta de tag de identidade vinda do LLM", () => {
    const out = mergeDescriptiveTags(["locacao"], ["slot:garantia", "provider:too"], {
      frozen: false,
    });
    expect(out).toBeNull();
  });

  it("descarta tag fora do vocabulário fechado", () => {
    expect(mergeDescriptiveTags(["x"], ["tema:invencao"], { frozen: false })).toBeNull();
  });

  it("normaliza a proposta antes de comparar", () => {
    const out = mergeDescriptiveTags([], ["tema:Vistoria"], { frozen: false });
    expect(out).toEqual(["tema:vistoria"]);
  });

  it("devolve null quando nada muda, pra não gerar diff vazio", () => {
    expect(mergeDescriptiveTags(["tema:vistoria"], ["tema:vistoria"], { frozen: false }))
      .toBeNull();
  });
});

describe("descriptiveVocabularyFor", () => {
  it("locação não recebe temas exclusivos de venda", () => {
    const tags = descriptiveVocabularyFor("locacao").map((d) => d.tag);
    expect(tags).toContain("tema:garantia");
    expect(tags).toContain("tema:foro"); // comum às duas
    expect(tags).not.toContain("tema:arras");
    expect(tags).not.toContain("requer:financiamento");
  });

  it("venda não recebe temas exclusivos de locação", () => {
    const tags = descriptiveVocabularyFor("venda").map((d) => d.tag);
    expect(tags).toContain("tema:arras");
    expect(tags).not.toContain("tema:renovatoria");
  });
});
