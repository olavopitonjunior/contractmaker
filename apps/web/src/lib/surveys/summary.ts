import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  getAnthropicClient,
  HAIKU_MODEL,
} from "@/lib/ai/shared/anthropic-client";
import { recordAIUsage } from "@/lib/ai/usage";
import {
  getOrgAiBudgetStatus,
  OrgAiBudgetExceededError,
} from "@/lib/ai/budget";
import { parseTemplateQuestions } from "./types";

/**
 * Resumo IA das respostas abertas de UM lote (SurveyTemplate concreto).
 *
 * Sob demanda + cache: o resumo fica em `settingsJson.aiSummary` com o hash
 * sha256 das respostas consideradas — regerar sem resposta nova devolve o
 * cache sem custo. Como o lote é imutável e só ganha respostas, o hash é um
 * invalidador natural.
 */

export const MIN_TEXT_RESPONSES = 3;
const MAX_RESPONSES = 100;
const MAX_INPUT_CHARS = 24_000;

export interface SurveyAiSummary {
  text: string;
  responseCount: number;
  hash: string;
  model: string;
  generatedAt: string;
}

export interface SummaryInput {
  /** Entradas "[NPS x · CSAT y] texto" prontas pro prompt. */
  entries: string[];
  /** Total de respostas de texto no lote (pré-cap). */
  textResponseCount: number;
  hash: string;
}

type AnswerRow = { questionId: string; type: string; value: unknown };

export async function buildSummaryInput(
  orgId: string,
  templateId: string
): Promise<SummaryInput | null> {
  const template = await prisma.surveyTemplate.findFirst({
    where: { id: templateId, orgId },
    select: { questionsJson: true },
  });
  if (!template) return null;

  const textIds = new Set(
    parseTemplateQuestions(template.questionsJson)
      .filter((q) => q.type === "text")
      .map((q) => q.id)
  );

  const responses = await prisma.surveyResponse.findMany({
    where: { orgId, templateId },
    orderBy: { createdAt: "asc" },
    select: { answersJson: true, npsScore: true, csatScore: true },
  });

  const entries: string[] = [];
  let textResponseCount = 0;
  for (const response of responses) {
    const answers = (response.answersJson ?? []) as AnswerRow[];
    if (!Array.isArray(answers)) continue;
    for (const answer of answers) {
      if (
        !textIds.has(answer.questionId) ||
        typeof answer.value !== "string" ||
        answer.value.trim().length === 0
      ) {
        continue;
      }
      textResponseCount++;
      const scores = [
        response.npsScore !== null ? `NPS ${response.npsScore}` : null,
        response.csatScore !== null ? `CSAT ${response.csatScore}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      entries.push(
        `[${scores || "sem nota"}] ${answer.value.trim().slice(0, 1500)}`
      );
    }
  }

  // Cap de custo: últimas MAX_RESPONSES entradas, teto de chars total.
  let capped = entries.slice(-MAX_RESPONSES);
  let totalChars = capped.reduce((acc, e) => acc + e.length, 0);
  while (totalChars > MAX_INPUT_CHARS && capped.length > 1) {
    const dropped = capped.shift()!;
    totalChars -= dropped.length;
  }

  const hash = createHash("sha256")
    .update(capped.join("\n---\n"))
    .digest("hex")
    .slice(0, 16);

  return { entries: capped, textResponseCount, hash };
}

const SYSTEM_PROMPT = `Você resume respostas abertas de pesquisas de satisfação de uma imobiliária (compra, venda e locação de imóveis). Escreva em português do Brasil, direto e útil pro gestor.

Formato da resposta (markdown leve, sem título):
- **Visão geral** — 1-2 frases sobre o tom geral, coerentes com as notas entre colchetes.
- **Pontos fortes** — até 3 tópicos.
- **Pontos de atenção** — até 3 tópicos (reclamações e padrões negativos; cite trechos curtos entre aspas quando ilustrativos, sem nomes de pessoas).
- **Ações sugeridas** — até 3 tópicos práticos.

Regras: não invente o que não está nas respostas; não exponha nomes ou dados pessoais; se as respostas forem poucas ou vagas, diga isso na visão geral.`;

export type GenerateSummaryResult =
  | { ok: true; summary: SurveyAiSummary; cached: boolean }
  | { ok: false; error: string; status: number };

export async function generateSurveySummary(args: {
  orgId: string;
  templateId: string;
  userId?: string | null;
}): Promise<GenerateSummaryResult> {
  const { orgId, templateId, userId } = args;

  const template = await prisma.surveyTemplate.findFirst({
    where: { id: templateId, orgId },
    select: { id: true, name: true, settingsJson: true },
  });
  if (!template) {
    return { ok: false, error: "Pesquisa não encontrada", status: 404 };
  }

  const input = await buildSummaryInput(orgId, templateId);
  if (!input || input.textResponseCount < MIN_TEXT_RESPONSES) {
    return {
      ok: false,
      error: `O resumo precisa de ao menos ${MIN_TEXT_RESPONSES} respostas de texto neste lote`,
      status: 400,
    };
  }

  const settings = (template.settingsJson ?? {}) as Record<string, unknown>;
  const cached = settings.aiSummary as SurveyAiSummary | undefined;
  if (cached?.hash === input.hash && cached.text) {
    return { ok: true, summary: cached, cached: true };
  }

  // Budget mensal de IA da org (mesmo gate do assertContractBudget, sem o
  // escopo por contrato — pesquisa não tem contractId).
  const budget = await getOrgAiBudgetStatus(orgId, { skipSpendWhenNoCap: true });
  if (budget.budgetUsd !== null && budget.pct >= 1) {
    throw new OrgAiBudgetExceededError(budget.spentUsd, budget.budgetUsd);
  }

  const t0 = Date.now();
  let text: string;
  let usage: { input_tokens?: number; output_tokens?: number } | undefined;
  try {
    const response = await getAnthropicClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 700,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Pesquisa: "${template.name}" — ${input.entries.length} respostas abertas (cada uma prefixada com as notas do respondente):\n\n${input.entries.join("\n---\n")}`,
        },
      ],
    });
    usage = response.usage;
    const block = response.content.find((b) => b.type === "text");
    text = block?.type === "text" ? block.text.trim() : "";
    recordAIUsage({
      orgId,
      userId,
      provider: "anthropic",
      model: HAIKU_MODEL,
      operation: "survey_summary",
      promptTokens: usage?.input_tokens ?? 0,
      completionTokens: usage?.output_tokens ?? 0,
      latencyMs: Date.now() - t0,
      success: true,
    });
  } catch (err) {
    recordAIUsage({
      orgId,
      userId,
      provider: "anthropic",
      model: HAIKU_MODEL,
      operation: "survey_summary",
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Falha ao gerar o resumo — tente novamente", status: 502 };
  }

  if (!text) {
    return { ok: false, error: "O modelo não retornou resumo", status: 502 };
  }

  const summary: SurveyAiSummary = {
    text,
    responseCount: input.textResponseCount,
    hash: input.hash,
    model: HAIKU_MODEL,
    generatedAt: new Date().toISOString(),
  };

  // Preserva as demais chaves do settingsJson (thankYouMessage etc.).
  await prisma.surveyTemplate.update({
    where: { id: template.id },
    data: {
      settingsJson: {
        ...settings,
        aiSummary: summary,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { ok: true, summary, cached: false };
}
