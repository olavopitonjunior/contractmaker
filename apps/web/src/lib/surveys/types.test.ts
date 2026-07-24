import { describe, it, expect } from "vitest";
import {
  surveyQuestionsSchema,
  validateAnswers,
  type SurveyQuestion,
} from "./types";

const VALID_QUESTIONS: SurveyQuestion[] = [
  { id: "nps", type: "nps", label: "Recomendaria a imobiliária?", required: true },
  { id: "csat", type: "csat", label: "Satisfação com o atendimento", required: true },
  {
    id: "canal",
    type: "single",
    label: "Como nos conheceu?",
    required: true,
    options: ["Indicação", "Internet", "Placa"],
  },
  {
    id: "pontos",
    type: "multi",
    label: "O que mais gostou?",
    required: false,
    options: ["Atendimento", "Agilidade", "Transparência"],
  },
  { id: "obs", type: "text", label: "Observações", required: false },
];

describe("surveyQuestionsSchema", () => {
  it("aceita os 5 tipos", () => {
    expect(surveyQuestionsSchema.safeParse(VALID_QUESTIONS).success).toBe(true);
  });

  it("rejeita 2 perguntas NPS", () => {
    const dup = [
      ...VALID_QUESTIONS,
      { id: "nps2", type: "nps", label: "De novo?", required: true },
    ];
    expect(surveyQuestionsSchema.safeParse(dup).success).toBe(false);
  });

  it("rejeita 2 perguntas CSAT", () => {
    const dup = [
      ...VALID_QUESTIONS,
      { id: "csat2", type: "csat", label: "De novo?", required: true },
    ];
    expect(surveyQuestionsSchema.safeParse(dup).success).toBe(false);
  });

  it("rejeita id duplicado", () => {
    const dup = [
      ...VALID_QUESTIONS,
      { id: "obs", type: "text", label: "Outra", required: false },
    ];
    expect(surveyQuestionsSchema.safeParse(dup).success).toBe(false);
  });

  it("rejeita seleção com menos de 2 opções", () => {
    const bad = [
      { id: "s", type: "single", label: "Só uma", required: true, options: ["A"] },
    ];
    expect(surveyQuestionsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejeita lista vazia e acima de 15", () => {
    expect(surveyQuestionsSchema.safeParse([]).success).toBe(false);
    const many = Array.from({ length: 16 }, (_, i) => ({
      id: `q${i}`,
      type: "text" as const,
      label: `Pergunta ${i}`,
      required: false,
    }));
    expect(surveyQuestionsSchema.safeParse(many).success).toBe(false);
  });
});

describe("validateAnswers", () => {
  const answer = (questionId: string, type: string, value: unknown) => ({
    questionId,
    type,
    value,
  });

  it("aceita respostas completas válidas", () => {
    const result = validateAnswers(VALID_QUESTIONS, [
      answer("nps", "nps", 10),
      answer("csat", "csat", 5),
      answer("canal", "single", "Indicação"),
      answer("pontos", "multi", ["Atendimento", "Agilidade"]),
      answer("obs", "text", "Tudo certo"),
    ]);
    expect(result.ok).toBe(true);
  });

  it("aceita omissão de perguntas opcionais", () => {
    const result = validateAnswers(VALID_QUESTIONS, [
      answer("nps", "nps", 8),
      answer("csat", "csat", 4),
      answer("canal", "single", "Internet"),
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejeita falta de pergunta obrigatória", () => {
    const result = validateAnswers(VALID_QUESTIONS, [
      answer("nps", "nps", 8),
      answer("csat", "csat", 4),
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejeita NPS fora de 0-10 e CSAT fora de 1-5", () => {
    const base = [
      answer("csat", "csat", 4),
      answer("canal", "single", "Placa"),
    ];
    expect(
      validateAnswers(VALID_QUESTIONS, [answer("nps", "nps", 11), ...base]).ok
    ).toBe(false);
    expect(
      validateAnswers(VALID_QUESTIONS, [
        answer("nps", "nps", 9),
        answer("csat", "csat", 0),
        answer("canal", "single", "Placa"),
      ]).ok
    ).toBe(false);
  });

  it("rejeita opção fora do domínio", () => {
    const result = validateAnswers(VALID_QUESTIONS, [
      answer("nps", "nps", 9),
      answer("csat", "csat", 4),
      answer("canal", "single", "Panfleto"),
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejeita pergunta desconhecida e resposta duplicada", () => {
    expect(
      validateAnswers(VALID_QUESTIONS, [
        answer("nps", "nps", 9),
        answer("csat", "csat", 4),
        answer("canal", "single", "Placa"),
        answer("fantasma", "text", "?"),
      ]).ok
    ).toBe(false);
    expect(
      validateAnswers(VALID_QUESTIONS, [
        answer("nps", "nps", 9),
        answer("nps", "nps", 2),
        answer("csat", "csat", 4),
        answer("canal", "single", "Placa"),
      ]).ok
    ).toBe(false);
  });

  it("rejeita tipo trocado (nps respondido como texto)", () => {
    const result = validateAnswers(VALID_QUESTIONS, [
      answer("nps", "text", "dez"),
      answer("csat", "csat", 4),
      answer("canal", "single", "Placa"),
    ]);
    expect(result.ok).toBe(false);
  });
});
