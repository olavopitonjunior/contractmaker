/**
 * PARIDADE: este arquivo é a tabela da lógica que morava inline nos
 * call-sites (agent.ts:981-989 pro passivo, getAgentConfig pro legado,
 * ocr.ts pros 3 usos do Gemini) antes de ser centralizada. Se o helper
 * divergir de qualquer linha daqui, o refactor mudou comportamento de
 * produção — e o objetivo era mudar NADA.
 */

import { describe, it, expect } from "vitest";
import {
  passiveEffectiveModel,
  chatLegacyEffectiveModel,
  ocrModelFromEnv,
  effectiveModels,
} from "../model-provenance";
import type { ResolvedAgentProfile } from "../resolve";

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";

function profile(over: Partial<ResolvedAgentProfile> = {}): ResolvedAgentProfile {
  return {
    agentKey: "passive",
    enabled: true,
    model: HAIKU,
    modelSource: "default",
    fallbackModel: null,
    temperature: null,
    maxTokens: null,
    platformInstructions: null,
    tenantInstructions: null,
    ragScope: null,
    monthlyBudgetUsd: null,
    config: null,
    ...over,
  };
}

describe("passiveEffectiveModel — paridade com agent.ts:981-989", () => {
  it("console configurado vence os envs, em qualquer trigger", () => {
    const p = profile({ model: "claude-opus-4-6", modelSource: "org" });
    const env = { ANTHROPIC_PASSIVE_OPEN_MODEL: SONNET, ANTHROPIC_PASSIVE_MODEL: SONNET };
    expect(passiveEffectiveModel(p, "open", env)).toBe("claude-opus-4-6");
    expect(passiveEffectiveModel(p, "edit", env)).toBe("claude-opus-4-6");
  });

  it("open: PASSIVE_OPEN_MODEL > ANTHROPIC_MODEL > Sonnet", () => {
    expect(
      passiveEffectiveModel(profile(), "open", {
        ANTHROPIC_PASSIVE_OPEN_MODEL: "claude-opus-4-6",
        ANTHROPIC_MODEL: HAIKU,
      })
    ).toBe("claude-opus-4-6");
    expect(
      passiveEffectiveModel(profile(), "open", { ANTHROPIC_MODEL: HAIKU })
    ).toBe(HAIKU);
    expect(passiveEffectiveModel(profile(), "open", {})).toBe(SONNET);
  });

  it("env com string vazia não engole o fallback (|| e não ??)", () => {
    expect(
      passiveEffectiveModel(profile(), "open", {
        ANTHROPIC_PASSIVE_OPEN_MODEL: "",
        ANTHROPIC_MODEL: HAIKU,
      })
    ).toBe(HAIKU);
  });

  it("edit: ANTHROPIC_PASSIVE_MODEL > Haiku (ANTHROPIC_MODEL não participa)", () => {
    expect(
      passiveEffectiveModel(profile(), "edit", { ANTHROPIC_MODEL: SONNET })
    ).toBe(HAIKU);
    expect(
      passiveEffectiveModel(profile(), "edit", { ANTHROPIC_PASSIVE_MODEL: SONNET })
    ).toBe(SONNET);
  });

  it("modelo aposentado no env migra pro substituto (o caso dos 2 meses)", () => {
    expect(
      passiveEffectiveModel(profile(), "open", {
        ANTHROPIC_PASSIVE_OPEN_MODEL: "claude-sonnet-4-20250514",
      })
    ).toBe(SONNET);
  });
});

describe("chatLegacyEffectiveModel — paridade com getAgentConfig", () => {
  it("fast é Haiku SEMPRE, mesmo com perfil configurado", () => {
    const p = profile({ model: "claude-opus-4-6", modelSource: "org" });
    expect(chatLegacyEffectiveModel(p, "fast", { ANTHROPIC_MODEL: SONNET })).toBe(
      HAIKU
    );
  });

  it("plan: perfil > ANTHROPIC_MODEL > default do perfil", () => {
    const configured = profile({ model: "claude-opus-4-6", modelSource: "platform" });
    expect(
      chatLegacyEffectiveModel(configured, "plan", { ANTHROPIC_MODEL: HAIKU })
    ).toBe("claude-opus-4-6");
    const unset = profile({ model: SONNET });
    expect(chatLegacyEffectiveModel(unset, "plan", { ANTHROPIC_MODEL: HAIKU })).toBe(
      HAIKU
    );
    expect(chatLegacyEffectiveModel(unset, "plan", {})).toBe(SONNET);
  });
});

describe("ocrModelFromEnv — paridade com ocr.ts", () => {
  it("GEMINI_OCR_MODEL > gemini-2.5-flash; vazia não engole", () => {
    expect(ocrModelFromEnv({ GEMINI_OCR_MODEL: "gemini-2.5-pro" })).toBe(
      "gemini-2.5-pro"
    );
    expect(ocrModelFromEnv({})).toBe("gemini-2.5-flash");
    expect(ocrModelFromEnv({ GEMINI_OCR_MODEL: "" })).toBe("gemini-2.5-flash");
  });
});

describe("effectiveModels — a visão da tela", () => {
  it("passivo sem configuração expõe as duas variantes com o envVar certo", () => {
    const rows = effectiveModels("passive", profile(), {
      ANTHROPIC_PASSIVE_OPEN_MODEL: "claude-sonnet-4-20250514",
    });
    expect(rows).toEqual([
      {
        context: "open",
        // Aposentado migra E a fonte continua acusando o env — é assim que a
        // tela denuncia o caso dos 2 meses em vez de escondê-lo.
        model: SONNET,
        source: "env",
        envVar: "ANTHROPIC_PASSIVE_OPEN_MODEL",
      },
      { context: "edit", model: HAIKU, source: "default", envVar: null },
    ]);
  });

  it("passivo configurado no console colapsa pra uma entrada só", () => {
    const rows = effectiveModels(
      "passive",
      profile({ model: SONNET, modelSource: "org" }),
      { ANTHROPIC_PASSIVE_OPEN_MODEL: HAIKU }
    );
    expect(rows).toEqual([
      { context: null, model: SONNET, source: "org", envVar: null },
    ]);
  });

  it("agregador é fixo por modo — perfil e env não participam", () => {
    const rows = effectiveModels(
      "aggregator",
      profile({ model: "claude-opus-4-6", modelSource: "org" }),
      { ANTHROPIC_MODEL: "claude-opus-4-6" }
    );
    expect(rows).toEqual([
      { context: "fast", model: HAIKU, source: "fixed", envVar: null },
      { context: "plan", model: SONNET, source: "fixed", envVar: null },
    ]);
  });

  it("especialista resolve só pelo perfil", () => {
    const rows = effectiveModels(
      "editor",
      profile({ agentKey: "editor", model: SONNET, modelSource: "platform" }),
      { ANTHROPIC_MODEL: HAIKU }
    );
    expect(rows).toEqual([
      { context: null, model: SONNET, source: "platform", envVar: null },
    ]);
  });
});
