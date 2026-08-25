/**
 * Verificador da FORMA DA REQUISIÇÃO para `POST /v1/messages`.
 *
 * ## Por que isto existe
 *
 * Este é o irmão de `schema-lint.ts`. Aquele valida o schema da SAÍDA; este
 * valida o corpo da ENTRADA — a outra metade da requisição, e a que já nos
 * custou o terceiro 400 do mesmo run de ingestão:
 *
 * | # | Erro real | O que era |
 * |---|---|---|
 * | 1 | `Enum value 'fiador' does not match declared type '['string','null']'` | schema |
 * | 2 | `For 'number' type, properties maximum, minimum are not supported` | schema |
 * | 3 | `adaptive thinking is not supported on this model` | **corpo** |
 *
 * O padrão dos três é o mesmo: nenhum teste desta base chama a API, então nada
 * aqui reprova uma requisição malformada — a descoberta acontece em produção e
 * custa um ciclo de deploy. Os dois primeiros já têm guarda local. Este módulo
 * fecha o terceiro caso.
 *
 * ## O que ele reprova
 *
 * Duas categorias. **Dependente do modelo** (`thinking` e `effort` em quem não
 * os aceita, nível de `effort` que a geração não conhece) — a régua é a tabela
 * de `model-capabilities.ts`, com a procedência de cada linha. E **invariante**
 * (sampling param, prefill, `budget_tokens`, `output_config.format` ausente) —
 * o que vale em qualquer modelo que este caminho use, e que é justamente a
 * razão de `anthropic-structured.ts` existir separado do cliente antigo.
 *
 * ## Como usar
 *
 * Sobre o corpo REAL que `buildStructuredRequest` monta, para cada modelo que o
 * código usa de verdade — ver `__tests__/request-lint.test.ts`. Assim, trocar
 * um `INGEST_*_MODEL` por um modelo incompatível quebra o teste em vez de
 * quebrar o run.
 */

import {
  capabilitiesFor,
  isKnownModel,
  supportsEffort,
  type EvidenceSource,
} from "@/lib/ai/shared/model-capabilities";

export type RequestLintRule =
  /** `thinking` mandado a um modelo que não tem raciocínio adaptativo. */
  | "adaptive_thinking_unsupported"
  /** `output_config.effort` mandado a um modelo que não aceita `effort`. */
  | "effort_unsupported"
  /** Nível de `effort` que a geração do modelo não conhece (ex.: `xhigh` no 4.6). */
  | "effort_level_unsupported"
  /** `thinking.budget_tokens` — removido na família 4.7+, e não usamos em lugar nenhum. */
  | "budget_tokens"
  /** `temperature` / `top_p` / `top_k`. */
  | "sampling_param"
  /** Mensagem final do assistente (prefill) — 400 na família 4.6+. */
  | "assistant_prefill"
  /** Sem `output_config.format` — a saída estruturada é o ponto deste caminho. */
  | "missing_output_format"
  /** Modelo fora da tabela de capacidades. */
  | "unknown_model";

export interface RequestLintIssue {
  rule: RequestLintRule;
  /** Procedência da regra — mesma disciplina de `schema-lint.ts`. */
  source: EvidenceSource;
  detail: string;
}

/** Parâmetros de amostragem. Nenhum deles pode aparecer neste caminho. */
const SAMPLING_PARAMS = ["temperature", "top_p", "top_k"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reprova combinações incompatíveis de modelo × corpo.
 *
 * Recebe o corpo como `unknown` de propósito: a tipagem de
 * `StructuredRequestBody` já impede alguns destes casos, e um validador que só
 * aceitasse o tipo bem-formado não conseguiria testar o que ele existe para
 * pegar. Lista vazia = requisição aceitável.
 */
export function lintStructuredRequest(body: unknown): RequestLintIssue[] {
  const out: RequestLintIssue[] = [];
  if (!isRecord(body)) {
    return [
      {
        rule: "missing_output_format",
        source: "deduced",
        detail: "o corpo da requisição não é um objeto.",
      },
    ];
  }

  const model = typeof body.model === "string" ? body.model : "";
  const caps = capabilitiesFor(model);

  if (!isKnownModel(model)) {
    out.push({
      rule: "unknown_model",
      source: "deduced",
      detail:
        `o modelo "${model}" não está na tabela de capacidades. Sem saber o que ` +
        "ele aceita, o corpo sai sem `thinking` e sem `effort` — que é seguro, " +
        "mas pode ser menos do que o modelo consegue. Adicione a linha em " +
        "`model-capabilities.ts`.",
    });
  }

  // ── Dependente do modelo ──────────────────────────────────────────────────

  const thinking = body.thinking;
  if (thinking !== undefined && !caps.adaptiveThinking) {
    out.push({
      rule: "adaptive_thinking_unsupported",
      source: caps.thinkingEvidence.source,
      detail:
        `${caps.family} não aceita \`thinking\`: ${caps.thinkingEvidence.note} ` +
        "Omita o parâmetro — não traduza para `budget_tokens`.",
    });
  }
  if (isRecord(thinking) && "budget_tokens" in thinking) {
    out.push({
      rule: "budget_tokens",
      source: "documented",
      detail:
        "`thinking.budget_tokens` foi removido na família 4.7+ (400) e este " +
        "caminho não o usa em modelo nenhum. A profundidade vem de " +
        "`output_config.effort`.",
    });
  }

  const outputConfig = body.output_config;
  const effort = isRecord(outputConfig) ? outputConfig.effort : undefined;
  if (effort !== undefined) {
    if (!supportsEffort(caps)) {
      out.push({
        rule: "effort_unsupported",
        source: caps.effortEvidence.source,
        detail:
          `${caps.family} não aceita \`output_config.effort\`: ` +
          `${caps.effortEvidence.note} Omita o campo.`,
      });
    } else if (!caps.effortLevels.includes(effort as never)) {
      out.push({
        rule: "effort_level_unsupported",
        source: caps.effortEvidence.source,
        detail:
          `\`effort: "${String(effort)}"\` não existe em ${caps.family} ` +
          `(aceita ${caps.effortLevels.join(", ")}). ${caps.effortEvidence.note}`,
      });
    }
  }

  // ── Invariante em qualquer modelo deste caminho ───────────────────────────

  for (const param of SAMPLING_PARAMS) {
    if (param in body) {
      out.push({
        rule: "sampling_param",
        source: "documented",
        detail:
          `\`${param}\` foi removido na família 4.7+ (400) e este caminho nunca ` +
          "manda sampling param — é a razão de ele existir separado do cliente " +
          "antigo, que expõe temperatura ao operador.",
      });
    }
  }

  const messages = body.messages;
  if (Array.isArray(messages)) {
    const last = messages[messages.length - 1];
    if (isRecord(last) && last.role === "assistant") {
      out.push({
        rule: "assistant_prefill",
        source: "documented",
        detail:
          "prefill (mensagem final do assistente) responde 400 na família 4.6+. " +
          "Para forçar o formato, use `output_config.format`.",
      });
    }
  }

  const format = isRecord(outputConfig) ? outputConfig.format : undefined;
  if (!isRecord(format) || format.type !== "json_schema") {
    out.push({
      rule: "missing_output_format",
      source: "deduced",
      detail:
        "sem `output_config.format: {type:'json_schema'}` a resposta não é " +
        "estruturada, e todo o parse deste caminho assume que ela é.",
    });
  }

  return out;
}

/** As issues em uma string só — o corpo da mensagem de falha de um teste. */
export function formatRequestLintIssues(
  issues: readonly RequestLintIssue[]
): string {
  return issues.map((i) => `[${i.rule}/${i.source}] ${i.detail}`).join("\n");
}
