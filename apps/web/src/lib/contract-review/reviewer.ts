// Revisor LLM pós-geração — a única chamada de IA do Workstream B.
//
// Roda pelo cliente estruturado da ingestão (runStructured: output_config com
// JSON Schema, zero sampling params, truncamento como erro TIPADO). O
// StructuredRunner é injetável — testes exercitam a escada sem rede.
//
// Mini-escada de 2 degraus, no espírito do planner: a 1ª resposta passa pelos
// guardrails; se o JSON veio truncado ou a MAIORIA dos achados caiu no
// validador, UM retry no mesmo modelo com as violações como feedback. Sem
// troca de família — o custo por revisão tem de ficar em centavos.
import {
  runStructured,
  StructuredOutputTruncatedError,
  type StructuredRunner,
  type StructuredUsage,
} from "@/lib/ai/shared/anthropic-structured";
import { CONTRACT_REVIEW_MODEL, resolveModel } from "@/lib/ai/shared/models";
import { PRICING } from "@/lib/ai/usage";
import type { SummarySection } from "@/lib/forms/negotiation-summary";
import type { GenerationPlan } from "./plan";
import { reviewPlaybookFor, type ReviewFamily } from "./playbooks";
import {
  validateReviewFindings,
  type AcceptedReviewFinding,
  type ReviewLlmOutput,
  type ReviewViolation,
} from "./guardrails";

// Teto de SAÍDA da chamada. O thinking adaptativo do Sonnet 5 (effort high)
// consome deste mesmo teto ANTES do JSON — 3k truncou nos dois degraus do
// aceite de staging (StructuredOutputTruncatedError). 16k dá folga para o
// raciocínio + os ~1-2k do JSON; o custo segue em centavos (output só é
// cobrado pelo que o modelo de fato emite).
export const REVIEW_MAX_TOKENS = 16_000;
/** Teto do texto do contrato no prompt (~15k tokens). Acima disso, corta com
 *  aviso no fim — contrato de locação/CCV real fica muito abaixo. */
export const REVIEW_DOC_TEXT_CAP = 60_000;

// Subconjunto ACEITO de JSON Schema do output_config (ver
// lib/ai/shared/schema-lint.ts): nada de maxItems/maxLength (400 real em
// staging, req_011CeUHW9zfUz84zouVdXdFY), todo campo em required, ausência
// como null. Os limites de quantidade/tamanho são cobrados pelo guardrail.
export const REVIEW_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "documentOk"],
  properties: {
    documentOk: {
      type: "boolean",
      description: "true quando não há nenhuma divergência real a apontar.",
    },
    findings: {
      type: "array",
      description: "No máximo 6 achados — priorize os mais graves.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "title", "finding", "selectedText", "expected", "suggestedFix"],
        properties: {
          category: {
            type: "string",
            enum: ["dados_form", "coerencia_juridica", "estrutura_documento"],
          },
          severity: { type: "string", enum: ["info", "warning"] },
          title: { type: "string", description: "Título curto (até 80 caracteres)." },
          finding: {
            type: "string",
            description: "A divergência, citando o valor do formulário e o do texto.",
          },
          selectedText: {
            type: "string",
            description: "Citação LITERAL do contrato (15-240 caracteres).",
          },
          expected: {
            type: ["string", "null"],
            description: "O que o formulário/plano diz. Null quando não se aplica.",
          },
          suggestedFix: {
            type: ["string", "null"],
            description: "Onde o operador corrige — nunca redação de cláusula. Null quando não há ação clara.",
          },
        },
      },
    },
  },
};

/** Resumo do formulário (SummarySection[]) em texto de prompt. */
export function renderFormSummaryText(sections: readonly SummarySection[]): string {
  if (sections.length === 0) return "(formulário sem resumo estruturado)";
  return sections
    .map(
      (s) =>
        `### ${s.title}\n` + s.rows.map((r) => `- ${r.label}: ${r.value}`).join("\n")
    )
    .join("\n");
}

/** Resumo do plano de geração em texto de prompt (nada de JSON cru). */
export function renderPlanSummaryText(plan: GenerationPlan | null): string {
  if (!plan) {
    return "(sem plano de geração — contrato anterior à materialização ou importado)";
  }
  const lines = [
    `- Template: "${plan.templateName}" (engine ${plan.engine}${plan.modalidade ? `, modalidade ${plan.modalidade}` : ""})`,
    `- Escolha: ${plan.selection.manual ? "manual pelo operador" : "automática pelo matcher"}`,
  ];
  if (plan.selection.garantiaMatched === false) {
    lines.push(
      "- ATENÇÃO: template de FALLBACK — a garantia do formulário não tem modelo próprio."
    );
  }
  if (plan.garantia) {
    lines.push(
      `- Garantia do formulário: ${plan.garantia.tipo ?? "(não declarada)"}` +
        (plan.garantia.provider ? ` — prestadora ${plan.garantia.provider}` : "")
    );
  }
  for (const r of plan.slots?.resolved ?? []) {
    lines.push(
      `- Slot ${r.slot}: cláusula ${r.source === "knowledge" ? "do acervo" : "padrão (fallback)"}` +
        (r.fromPlatform ? " — da base da plataforma" : "")
    );
  }
  for (const f of plan.slots?.failures ?? []) {
    lines.push(`- Falha de slot (${f.slot}): ${f.reason}`);
  }
  return lines.join("\n");
}

export interface BuildReviewUserContentInput {
  formSummaryText: string;
  planSummaryText: string;
  existingComments: readonly string[];
  docText: string;
  /** Feedback do degrau anterior (retry). */
  feedback?: string;
}

export function buildReviewUserContent(input: BuildReviewUserContentInput): string {
  const doc =
    input.docText.length > REVIEW_DOC_TEXT_CAP
      ? `${input.docText.slice(0, REVIEW_DOC_TEXT_CAP)}\n\n[TEXTO CORTADO NO LIMITE — o contrato continua além deste ponto]`
      : input.docText;
  const existing =
    input.existingComments.length > 0
      ? input.existingComments.map((c) => `- ${c}`).join("\n")
      : "(nenhum)";
  return [
    "## RESUMO DO NEGÓCIO (formulário)",
    input.formSummaryText,
    "",
    "## PLANO DE GERAÇÃO (o que o motor decidiu)",
    input.planSummaryText,
    "",
    "## JÁ APONTADO (não repetir)",
    existing,
    ...(input.feedback
      ? ["", "## FEEDBACK DA TENTATIVA ANTERIOR (corrija estes problemas)", input.feedback]
      : []),
    "",
    "## TEXTO DO CONTRATO",
    doc,
  ].join("\n");
}

export interface ContractReviewLlmInput {
  family: ReviewFamily;
  formSummaryText: string;
  planSummaryText: string;
  docText: string;
  /** Texto/âncora dos comentários IA não resolvidos (anti-duplicação). */
  existingComments: readonly { text: string; selectedText: string }[];
  /** Injeção de teste. */
  structured?: StructuredRunner;
  model?: string;
}

export interface ContractReviewStepUsage {
  model: string;
  usage: StructuredUsage;
  latencyMs: number;
}

export interface ContractReviewLlmResult {
  findings: AcceptedReviewFinding[];
  documentOk: boolean;
  violations: ReviewViolation[];
  steps: ContractReviewStepUsage[];
  retried: boolean;
}

export function resolveReviewModel(): string {
  const model = resolveModel(process.env.CONTRACT_REVIEW_MODEL, CONTRACT_REVIEW_MODEL);
  if (!PRICING[model]) {
    // Fora do PRICING o custo grava zero e o cap diário deixa de segurar
    // qualquer coisa — o único modo de falha que o budget não pode ter.
    console.warn(
      `[contract-review] modelo "${model}" sem entrada no PRICING — custo será gravado como zero e o cap diário fica cego.`
    );
  }
  return model;
}

export async function runContractReviewLlm(
  input: ContractReviewLlmInput
): Promise<ContractReviewLlmResult> {
  const structured = input.structured ?? runStructured;
  const model = input.model ?? resolveReviewModel();
  const playbook = reviewPlaybookFor(input.family);
  const existingTexts = input.existingComments.map((c) => c.selectedText);
  const existingLabels = input.existingComments.map(
    (c) => `${c.text.slice(0, 120)} [trecho: ${c.selectedText.slice(0, 80)}]`
  );
  const steps: ContractReviewStepUsage[] = [];

  const callOnce = async (feedback?: string): Promise<ReviewLlmOutput> => {
    const result = await structured<ReviewLlmOutput>({
      model,
      system: [{ text: playbook.prompt, cache: true }],
      userContent: buildReviewUserContent({
        formSummaryText: input.formSummaryText,
        planSummaryText: input.planSummaryText,
        existingComments: existingLabels,
        docText: input.docText,
        feedback,
      }),
      schema: REVIEW_OUTPUT_SCHEMA,
      maxTokens: REVIEW_MAX_TOKENS,
      effort: "high",
      // Sem streaming a conexão fica muda enquanto o modelo pensa — com
      // maxTokens deste tamanho é assim que uma chamada morre no timeout.
      stream: true,
    });
    steps.push({ model: result.model, usage: result.usage, latencyMs: result.latencyMs });
    return result.data;
  };

  let output: ReviewLlmOutput | null = null;
  let truncatedFeedback: string | undefined;
  try {
    output = await callOnce();
  } catch (err) {
    if (!(err instanceof StructuredOutputTruncatedError)) throw err;
    truncatedFeedback =
      "A resposta anterior estourou o limite de tokens. Responda com MENOS achados (só os mais graves) e textos mais curtos.";
  }

  let validated = output
    ? validateReviewFindings(output, {
        docText: input.docText,
        playbook,
        existingSelectedTexts: existingTexts,
      })
    : null;

  const majorityDiscarded =
    validated !== null &&
    output !== null &&
    output.findings.length > 0 &&
    validated.violations.length * 2 > output.findings.length;

  let retried = false;
  if (truncatedFeedback || majorityDiscarded) {
    retried = true;
    const feedback =
      truncatedFeedback ?? validated!.violations.map((v) => `- ${v.detail}`).join("\n");
    output = await callOnce(feedback);
    validated = validateReviewFindings(output, {
      docText: input.docText,
      playbook,
      existingSelectedTexts: existingTexts,
    });
  }

  return {
    findings: validated?.accepted ?? [],
    documentOk: output?.documentOk ?? true,
    violations: validated?.violations ?? [],
    steps,
    retried,
  };
}
