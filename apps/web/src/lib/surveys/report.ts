import { prisma } from "@/lib/db/prisma";
import { npsFromDistribution } from "./scores";
import { parseTemplateQuestions, type SurveyQuestion } from "./types";
import type { SurveyAiSummary } from "./summary";

/**
 * Agregação do relatório de UM lote (templateId concreto). O sistema nunca
 * consolida lotes diferentes — versões da mesma família têm relatórios
 * separados e o seletor da UI escolhe qual ver.
 */

export interface SurveyReport {
  template: {
    id: string;
    familyId: string;
    name: string;
    version: number;
    status: string;
    createdAt: string;
  };
  totals: {
    invites: number;
    responses: number;
    responseRate: number | null; // %
    optouts: number;
  };
  nps: {
    score: number | null;
    distribution: Record<number, number>; // nota 0-10 → qtd
    promoters: number;
    passives: number;
    detractors: number;
  };
  csat: {
    average: number | null;
    distribution: Record<number, number>; // nota 1-5 → qtd
  };
  /** Distribuições das perguntas de seleção: questionId → opção → qtd. */
  choices: Array<{
    questionId: string;
    label: string;
    multi: boolean;
    counts: Record<string, number>;
  }>;
  /** Cards das observações escritas. */
  comments: Array<{
    id: string;
    text: string;
    role: string;
    respondentName: string | null;
    npsScore: number | null;
    csatScore: number | null;
    dealId: string | null;
    dealTitle: string | null;
    dealKind: string | null;
    createdAt: string;
  }>;
  /** Respostas por semana (ISO date do início) pro line chart. */
  weekly: Array<{ week: string; count: number }>;
  /** Resumo IA cacheado do lote (settingsJson.aiSummary), se já gerado. */
  aiSummary: SurveyAiSummary | null;
  /** Total de respostas de texto do lote (habilita/atualiza o botão de resumo). */
  textResponseCount: number;
}

type AnswerRow = { questionId: string; type: string; value: unknown };

export async function buildSurveyReport(
  orgId: string,
  templateId: string
): Promise<SurveyReport | null> {
  const template = await prisma.surveyTemplate.findFirst({
    where: { id: templateId, orgId },
    select: {
      id: true,
      familyId: true,
      name: true,
      version: true,
      status: true,
      createdAt: true,
      questionsJson: true,
      settingsJson: true,
    },
  });
  if (!template) return null;

  const questions = parseTemplateQuestions(template.questionsJson);

  const [inviteGroups, responses] = await Promise.all([
    prisma.surveyInvite.groupBy({
      by: ["status"],
      where: { orgId, templateId },
      _count: { _all: true },
    }),
    prisma.surveyResponse.findMany({
      where: { orgId, templateId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        respondentRole: true,
        answersJson: true,
        npsScore: true,
        csatScore: true,
        dealId: true,
        createdAt: true,
        invite: { select: { recipientName: true } },
        // dealId → título via join separado (Deal não relaciona direto aqui)
      },
    }),
  ]);

  const inviteCount = inviteGroups.reduce((acc, g) => acc + g._count._all, 0);
  const optouts =
    inviteGroups.find((g) => g.status === "optout")?._count._all ?? 0;

  // Distribuições NPS/CSAT a partir das colunas derivadas.
  const npsDist: Record<number, number> = {};
  const csatDist: Record<number, number> = {};
  for (const r of responses) {
    if (r.npsScore !== null) npsDist[r.npsScore] = (npsDist[r.npsScore] ?? 0) + 1;
    if (r.csatScore !== null) csatDist[r.csatScore] = (csatDist[r.csatScore] ?? 0) + 1;
  }
  const csatValues = responses
    .map((r) => r.csatScore)
    .filter((v): v is number => v !== null);
  const csatAverage =
    csatValues.length > 0
      ? Math.round((csatValues.reduce((a, b) => a + b, 0) / csatValues.length) * 10) / 10
      : null;

  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const [scoreStr, count] of Object.entries(npsDist)) {
    const score = Number(scoreStr);
    if (score >= 9) promoters += count;
    else if (score >= 7) passives += count;
    else detractors += count;
  }

  // Perguntas de seleção: conta por opção varrendo answersJson.
  const choiceQuestions = questions.filter(
    (q): q is Extract<SurveyQuestion, { type: "single" | "multi" }> =>
      q.type === "single" || q.type === "multi"
  );
  const choices = choiceQuestions.map((q) => {
    const counts: Record<string, number> = Object.fromEntries(
      q.options.map((o) => [o, 0])
    );
    for (const r of responses) {
      const answers = (r.answersJson ?? []) as AnswerRow[];
      const answer = Array.isArray(answers)
        ? answers.find((a) => a.questionId === q.id)
        : undefined;
      if (!answer) continue;
      const values = Array.isArray(answer.value) ? answer.value : [answer.value];
      for (const v of values) {
        if (typeof v === "string" && v in counts) counts[v] += 1;
      }
    }
    return { questionId: q.id, label: q.label, multi: q.type === "multi", counts };
  });

  // Cards de texto aberto.
  const textIds = new Set(questions.filter((q) => q.type === "text").map((q) => q.id));
  const commentRows = responses.flatMap((r) => {
    const answers = (r.answersJson ?? []) as AnswerRow[];
    if (!Array.isArray(answers)) return [];
    return answers
      .filter(
        (a) =>
          textIds.has(a.questionId) &&
          typeof a.value === "string" &&
          a.value.trim().length > 0
      )
      .map((a) => ({
        id: `${r.id}:${a.questionId}`,
        text: String(a.value).slice(0, 2000),
        role: r.respondentRole,
        respondentName: r.invite?.recipientName ?? null,
        npsScore: r.npsScore,
        csatScore: r.csatScore,
        dealId: r.dealId,
        dealTitle: null as string | null,
        dealKind: null as string | null,
        createdAt: r.createdAt.toISOString(),
      }));
  });

  // Título dos deals citados nos cards (um IN só).
  const dealIds = Array.from(
    new Set(commentRows.map((c) => c.dealId).filter((id): id is string => !!id))
  );
  if (dealIds.length > 0) {
    const deals = await prisma.deal.findMany({
      where: { id: { in: dealIds } },
      select: { id: true, title: true, kind: true },
    });
    const dealById = new Map(deals.map((d) => [d.id, d]));
    for (const c of commentRows) {
      if (c.dealId) {
        const deal = dealById.get(c.dealId);
        c.dealTitle = deal?.title ?? null;
        c.dealKind = deal?.kind ?? null;
      }
    }
  }

  // Respostas por semana (client renderiza LineChart).
  const weekly = new Map<string, number>();
  for (const r of responses) {
    const d = new Date(r.createdAt);
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    weekly.set(key, (weekly.get(key) ?? 0) + 1);
  }

  return {
    template: {
      id: template.id,
      familyId: template.familyId,
      name: template.name,
      version: template.version,
      status: template.status,
      createdAt: template.createdAt.toISOString(),
    },
    totals: {
      invites: inviteCount,
      responses: responses.length,
      responseRate:
        inviteCount > 0 ? Math.round((responses.length / inviteCount) * 100) : null,
      optouts,
    },
    nps: {
      score: npsFromDistribution(npsDist),
      distribution: npsDist,
      promoters,
      passives,
      detractors,
    },
    csat: { average: csatAverage, distribution: csatDist },
    choices,
    comments: commentRows.slice(0, 100),
    weekly: Array.from(weekly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, count]) => ({ week, count })),
    aiSummary:
      ((template.settingsJson as Record<string, unknown> | null)?.aiSummary as
        | SurveyAiSummary
        | undefined) ?? null,
    textResponseCount: commentRows.length,
  };
}
