/**
 * A guarda do TERCEIRO 400 do run de ingestão:
 *
 * ```
 * adaptive thinking is not supported on this model
 * request_id=req_011CeQAUDeoHXkcoR4pA3NxW
 * ```
 *
 * O teste que importa é o último bloco: ele monta o corpo REAL, com
 * `buildStructuredRequest`, para cada modelo que o código usa de verdade, e o
 * passa pelo validador. Trocar um `INGEST_*_MODEL` por um modelo incompatível
 * quebra aqui, e não em produção.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildStructuredRequest,
  type EffortLevel,
  type StructuredCallInput,
} from "@/lib/ai/shared/anthropic-structured";
import {
  formatRequestLintIssues,
  lintStructuredRequest,
} from "@/lib/ai/shared/request-lint";
import {
  INGEST_CLASSIFY_MODEL,
  INGEST_ESCALATION_MODEL,
  INGEST_PLAN_MODEL,
} from "@/lib/ai/shared/models";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

function input(
  model: string,
  effort: EffortLevel = "high"
): StructuredCallInput {
  return {
    model,
    system: [{ text: "regras", cache: true }],
    userContent: "documento",
    schema: SCHEMA,
    maxTokens: 2_000,
    effort,
  };
}

/** Um corpo bem-formado para um modelo moderno, base das mutações abaixo. */
function modernBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "claude-opus-4-8",
    max_tokens: 1_000,
    system: [{ type: "text", text: "regras" }],
    messages: [{ role: "user", content: "documento" }],
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: SCHEMA },
    },
    ...overrides,
  };
}

describe("lintStructuredRequest — incompatibilidade por modelo", () => {
  it("thinking adaptativo em Haiku 4.5 é reprovado, e como CONFIRMADO", () => {
    const issues = lintStructuredRequest(
      modernBody({ model: "claude-haiku-4-5", output_config: { format: { type: "json_schema", schema: SCHEMA } } })
    );

    const thinking = issues.find((i) => i.rule === "adaptive_thinking_unsupported");
    expect(thinking).toBeTruthy();
    // É o único que temos um 400 nosso para provar — a procedência diz isso.
    expect(thinking?.source).toBe("confirmed");
    expect(thinking?.detail).toContain("req_011CeQAUDeoHXkcoR4pA3NxW");
  });

  it("effort em Haiku 4.5 é reprovado, como DOCUMENTADO", () => {
    const issues = lintStructuredRequest(
      modernBody({ model: "claude-haiku-4-5", thinking: undefined })
    );
    const effort = issues.find((i) => i.rule === "effort_unsupported");
    expect(effort).toBeTruthy();
    // Este ainda não estourou — o thinking falha antes. Não é "confirmado".
    expect(effort?.source).toBe("documented");
  });

  it("o corpo certo para Haiku 4.5 — sem thinking, sem effort — passa", () => {
    const issues = lintStructuredRequest({
      model: "claude-haiku-4-5",
      max_tokens: 2_000,
      system: [{ type: "text", text: "regras" }],
      messages: [{ role: "user", content: "documento" }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    expect(formatRequestLintIssues(issues)).toBe("");
  });

  it("xhigh no Opus 4.6 é reprovado — o nível só existe a partir do 4.7", () => {
    const issues = lintStructuredRequest(
      modernBody({
        model: "claude-opus-4-6",
        output_config: {
          effort: "xhigh",
          format: { type: "json_schema", schema: SCHEMA },
        },
      })
    );
    const level = issues.find((i) => i.rule === "effort_level_unsupported");
    expect(level?.detail).toContain("Opus 4.6");
    expect(level?.detail).toContain("low, medium, high, max");
  });

  it("high no Opus 4.6 passa — a família aceita o nível", () => {
    expect(
      lintStructuredRequest(modernBody({ model: "claude-opus-4-6" }))
    ).toEqual([]);
  });

  it("modelo fora da tabela é sinalizado, como DEDUZIDO", () => {
    const issues = lintStructuredRequest(modernBody({ model: "claude-quantum-9" }));
    const unknown = issues.find((i) => i.rule === "unknown_model");
    expect(unknown?.source).toBe("deduced");
    expect(unknown?.detail).toContain("model-capabilities.ts");
  });
});

describe("lintStructuredRequest — invariantes de qualquer modelo", () => {
  it.each(["temperature", "top_p", "top_k"])("reprova `%s`", (param) => {
    const issues = lintStructuredRequest(modernBody({ [param]: 0.5 }));
    expect(issues.map((i) => i.rule)).toContain("sampling_param");
  });

  it("reprova budget_tokens, mesmo com o thinking aceito pelo modelo", () => {
    const issues = lintStructuredRequest(
      modernBody({ thinking: { type: "enabled", budget_tokens: 4_000 } })
    );
    expect(issues.map((i) => i.rule)).toContain("budget_tokens");
  });

  it("reprova prefill — mensagem final do assistente", () => {
    const issues = lintStructuredRequest(
      modernBody({
        messages: [
          { role: "user", content: "documento" },
          { role: "assistant", content: "{" },
        ],
      })
    );
    expect(issues.map((i) => i.rule)).toContain("assistant_prefill");
  });

  it("assistente no MEIO da conversa não é prefill", () => {
    const issues = lintStructuredRequest(
      modernBody({
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
          { role: "user", content: "c" },
        ],
      })
    );
    expect(issues.map((i) => i.rule)).not.toContain("assistant_prefill");
  });

  it("reprova a ausência de output_config.format", () => {
    const issues = lintStructuredRequest(
      modernBody({ output_config: { effort: "high" } })
    );
    expect(issues.map((i) => i.rule)).toContain("missing_output_format");
  });

  it("corpo que nem é objeto não lança", () => {
    expect(lintStructuredRequest(null).map((i) => i.rule)).toEqual([
      "missing_output_format",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// O teste de contrato: o corpo REAL, para os modelos REAIS.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Todo par (modelo, effort) que o código realmente emite.
 *
 * O planner aparece DUAS vezes porque a escada de escalação sobe o effort no
 * mesmo modelo antes de trocar de família (`planner.ts` → `ladder`): validar só
 * o degrau base deixaria passar um `xhigh` num modelo que não o conhece.
 */
const REAL_MODELS: Array<[string, string, EffortLevel]> = [
  ["classificação", INGEST_CLASSIFY_MODEL, "low"],
  ["plano — degrau base", INGEST_PLAN_MODEL, "high"],
  ["plano — degrau de profundidade", INGEST_PLAN_MODEL, "xhigh"],
  ["escalação", INGEST_ESCALATION_MODEL, "xhigh"],
];

describe("contrato — o corpo que runStructured monta para cada modelo usado", () => {
  it.each(REAL_MODELS)(
    "%s (%s) monta um corpo que o validador aceita",
    (_papel, model, effort) => {
      const body = buildStructuredRequest(input(model, effort));
      const issues = lintStructuredRequest(body);
      expect(formatRequestLintIssues(issues)).toBe("");
    }
  );

  it("o classificador (Haiku 4.5) sai SEM thinking e SEM effort", () => {
    const body = buildStructuredRequest(input(INGEST_CLASSIFY_MODEL, "low"));

    expect(body).not.toHaveProperty("thinking");
    expect(body.output_config).not.toHaveProperty("effort");
    // O que não muda: a saída continua estruturada.
    expect(body.output_config.format).toEqual({
      type: "json_schema",
      schema: SCHEMA,
    });
  });

  it("o planner (Opus 4.8) sai COM thinking explícito e com effort", () => {
    // Explícito porque no Opus 4.8 omitir `thinking` significa rodar sem
    // raciocínio — o oposto do Haiku, onde mandá-lo é 400.
    const body = buildStructuredRequest(input(INGEST_PLAN_MODEL, "high"));

    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config.effort).toBe("high");
  });

  it("nenhum modelo real recebe sampling param ou prefill", () => {
    for (const [, model, effort] of REAL_MODELS) {
      const body = buildStructuredRequest(input(model, effort));
      const json = JSON.stringify(body);
      expect(json, model).not.toContain("temperature");
      expect(json, model).not.toContain("top_p");
      expect(json, model).not.toContain("budget_tokens");
      expect(body.messages.every((m) => m.role === "user"), model).toBe(true);
    }
  });

  it("modelo desconhecido avisa no log e sai conservador", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = buildStructuredRequest(input("claude-quantum-9", "high"));

    expect(body).not.toHaveProperty("thinking");
    expect(body.output_config).not.toHaveProperty("effort");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("claude-quantum-9"));
    warn.mockRestore();
  });
});
