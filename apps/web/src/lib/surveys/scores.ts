import type { SurveyAnswer, SurveyQuestion } from "./types";

/**
 * Derivação e agregação das notas NPS/CSAT.
 *
 * NPS: promotores (9-10) − detratores (0-6), em % de respostas — resultado
 * em [-100, 100]. CSAT: média simples da escala 1-5.
 */

export function deriveScores(
  questions: SurveyQuestion[],
  answers: SurveyAnswer[]
): { npsScore: number | null; csatScore: number | null } {
  let npsScore: number | null = null;
  let csatScore: number | null = null;

  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  for (const question of questions) {
    const answer = byQuestion.get(question.id);
    if (!answer || typeof answer.value !== "number") continue;
    if (question.type === "nps" && npsScore === null) npsScore = answer.value;
    if (question.type === "csat" && csatScore === null) csatScore = answer.value;
  }

  return { npsScore, csatScore };
}

/**
 * NPS a partir da distribuição de notas 0-10 (`counts[nota] = qtd`).
 * Retorna null sem respostas. Arredonda pro inteiro mais próximo (padrão de
 * mercado — NPS é reportado sem casas decimais).
 */
export function npsFromDistribution(
  counts: Record<number, number>
): number | null {
  let promoters = 0;
  let detractors = 0;
  let total = 0;
  for (let score = 0; score <= 10; score++) {
    const count = counts[score] ?? 0;
    total += count;
    if (score >= 9) promoters += count;
    if (score <= 6) detractors += count;
  }
  if (total === 0) return null;
  return Math.round(((promoters - detractors) / total) * 100);
}

export function npsCategory(score: number): "detrator" | "neutro" | "promotor" {
  if (score <= 6) return "detrator";
  if (score <= 8) return "neutro";
  return "promotor";
}

/**
 * Gatilho do alerta interno pós-resposta: detrator NPS (0-6) ou CSAT baixo
 * (1-2). Nota ausente não dispara.
 */
export function isDetractor(
  npsScore: number | null,
  csatScore: number | null
): boolean {
  if (npsScore !== null && npsScore <= 6) return true;
  if (csatScore !== null && csatScore <= 2) return true;
  return false;
}
