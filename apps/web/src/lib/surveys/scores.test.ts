import { describe, it, expect } from "vitest";
import {
  deriveScores,
  npsFromDistribution,
  npsCategory,
  isDetractor,
} from "./scores";
import type { SurveyQuestion } from "./types";

const QUESTIONS: SurveyQuestion[] = [
  { id: "q1", type: "nps", label: "Recomendaria?", required: true },
  { id: "q2", type: "csat", label: "Satisfação", required: true },
  { id: "q3", type: "text", label: "Comentário", required: false },
];

describe("deriveScores", () => {
  it("extrai nps e csat das respostas numéricas", () => {
    const scores = deriveScores(QUESTIONS, [
      { questionId: "q1", type: "nps", value: 9 },
      { questionId: "q2", type: "csat", value: 4 },
      { questionId: "q3", type: "text", value: "ótimo" },
    ]);
    expect(scores).toEqual({ npsScore: 9, csatScore: 4 });
  });

  it("retorna null quando a pergunta não foi respondida", () => {
    const scores = deriveScores(QUESTIONS, [
      { questionId: "q3", type: "text", value: "só comentário" },
    ]);
    expect(scores).toEqual({ npsScore: null, csatScore: null });
  });

  it("ignora valor não-numérico em pergunta de nota", () => {
    const scores = deriveScores(QUESTIONS, [
      { questionId: "q1", type: "nps", value: "9" },
    ]);
    expect(scores.npsScore).toBeNull();
  });
});

describe("npsFromDistribution", () => {
  it("calcula promotores − detratores em %", () => {
    // 6 promotores (60%), 2 neutros, 2 detratores (20%) → NPS 40
    expect(
      npsFromDistribution({ 10: 4, 9: 2, 8: 1, 7: 1, 6: 1, 3: 1 })
    ).toBe(40);
  });

  it("extremos: só promotores = 100, só detratores = -100", () => {
    expect(npsFromDistribution({ 10: 5 })).toBe(100);
    expect(npsFromDistribution({ 0: 3, 6: 2 })).toBe(-100);
  });

  it("sem respostas retorna null", () => {
    expect(npsFromDistribution({})).toBeNull();
  });
});

describe("npsCategory", () => {
  it("classifica nas faixas padrão", () => {
    expect(npsCategory(0)).toBe("detrator");
    expect(npsCategory(6)).toBe("detrator");
    expect(npsCategory(7)).toBe("neutro");
    expect(npsCategory(8)).toBe("neutro");
    expect(npsCategory(9)).toBe("promotor");
    expect(npsCategory(10)).toBe("promotor");
  });
});

describe("isDetractor", () => {
  it("nps <= 6 dispara", () => {
    expect(isDetractor(6, null)).toBe(true);
    expect(isDetractor(7, null)).toBe(false);
  });

  it("csat <= 2 dispara", () => {
    expect(isDetractor(null, 2)).toBe(true);
    expect(isDetractor(null, 3)).toBe(false);
  });

  it("sem notas não dispara", () => {
    expect(isDetractor(null, null)).toBe(false);
  });
});
