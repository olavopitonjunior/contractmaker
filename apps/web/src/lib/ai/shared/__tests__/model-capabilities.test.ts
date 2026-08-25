import { describe, it, expect } from "vitest";
import {
  capabilitiesFor,
  CONSERVATIVE_FALLBACK,
  isKnownModel,
  knownModelPrefixes,
  supportsEffort,
} from "@/lib/ai/shared/model-capabilities";
import {
  HAIKU_MODEL,
  INGEST_CLASSIFY_MODEL,
  INGEST_ESCALATION_MODEL,
  INGEST_PLAN_MODEL,
} from "@/lib/ai/shared/models";

describe("tabela de capacidades — as duas gerações", () => {
  it("Haiku 4.5 não tem adaptativo nem effort", () => {
    const caps = capabilitiesFor("claude-haiku-4-5");
    expect(caps.family).toBe("Haiku 4.5");
    expect(caps.adaptiveThinking).toBe(false);
    expect(supportsEffort(caps)).toBe(false);
  });

  it("a família 4.7+ tem os dois, com todos os níveis", () => {
    for (const model of ["claude-opus-4-8", "claude-opus-5", "claude-sonnet-5"]) {
      const caps = capabilitiesFor(model);
      expect(caps.adaptiveThinking, model).toBe(true);
      expect(caps.effortLevels, model).toContain("xhigh");
      expect(caps.effortLevels, model).toContain("max");
    }
  });

  it("a família 4.6 tem adaptativo, mas não conhece xhigh", () => {
    for (const model of ["claude-opus-4-6", "claude-sonnet-4-6"]) {
      const caps = capabilitiesFor(model);
      expect(caps.adaptiveThinking, model).toBe(true);
      expect(caps.effortLevels, model).not.toContain("xhigh");
      expect(caps.effortLevels, model).toContain("high");
    }
  });
});

describe("tabela de capacidades — casamento do id", () => {
  it("o id com sufixo de data casa com a mesma família", () => {
    // `HAIKU_MODEL` do caminho antigo é `claude-haiku-4-5-20251001`; é o MESMO
    // modelo do `INGEST_CLASSIFY_MODEL`, e a tabela precisa enxergar isso.
    expect(HAIKU_MODEL).toContain("claude-haiku-4-5");
    expect(capabilitiesFor(HAIKU_MODEL).family).toBe("Haiku 4.5");
    expect(capabilitiesFor(HAIKU_MODEL)).toEqual(
      capabilitiesFor(INGEST_CLASSIFY_MODEL)
    );
  });

  it("o prefixo mais específico ganha — 4.8 não cai no 4.6", () => {
    expect(capabilitiesFor("claude-opus-4-8").family).toBe("Opus 4.8");
    expect(capabilitiesFor("claude-opus-4-6").family).toBe("Opus 4.6");
  });

  it("modelo fora da tabela cai no conservador", () => {
    expect(isKnownModel("claude-quantum-9")).toBe(false);
    expect(capabilitiesFor("claude-quantum-9")).toBe(CONSERVATIVE_FALLBACK);
    // Conservador = não mandar nada: omitir nunca dá 400, mandar pode dar.
    expect(CONSERVATIVE_FALLBACK.adaptiveThinking).toBe(false);
    expect(supportsEffort(CONSERVATIVE_FALLBACK)).toBe(false);
  });

  it("string vazia não quebra a busca", () => {
    expect(isKnownModel("")).toBe(false);
  });
});

describe("tabela de capacidades — cobertura dos modelos que usamos", () => {
  it("todo modelo do caminho de ingestão está na tabela", () => {
    // Esta é a garantia que sustenta o fallback conservador: ele existe para o
    // imprevisto, não para os modelos que escolhemos. Trocar uma constante por
    // um modelo não catalogado quebra aqui.
    for (const model of [
      INGEST_CLASSIFY_MODEL,
      INGEST_PLAN_MODEL,
      INGEST_ESCALATION_MODEL,
    ]) {
      expect(isKnownModel(model), model).toBe(true);
    }
  });

  it("a procedência do Haiku 4.5 aponta o 400 real, com request_id", () => {
    const caps = capabilitiesFor(INGEST_CLASSIFY_MODEL);
    expect(caps.thinkingEvidence.source).toBe("confirmed");
    expect(caps.thinkingEvidence.note).toContain("req_011CeQAUDeoHXkcoR4pA3NxW");
    // O effort ainda não estourou — o thinking falha antes. Não inflar a prova.
    expect(caps.effortEvidence.source).toBe("documented");
  });

  it("nenhum prefixo da tabela é prefixo de outro colocado depois", () => {
    // Ordem errada faria `claude-opus-4-8` casar com uma linha genérica de
    // `claude-opus-4` e receber as capacidades erradas em silêncio.
    const prefixes = knownModelPrefixes();
    prefixes.forEach((prefix, i) => {
      const shadowed = prefixes
        .slice(0, i)
        .find((earlier) => prefix.startsWith(earlier));
      expect(shadowed, `${prefix} é ocultado por ${shadowed}`).toBeUndefined();
    });
  });
});
