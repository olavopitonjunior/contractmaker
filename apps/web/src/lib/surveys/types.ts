import { z } from "zod";

/**
 * Tipos e validação das pesquisas de satisfação.
 *
 * SurveyTemplate é IMUTÁVEL após criação: `questionsJson` nunca recebe PATCH.
 * Cada row é um LOTE com relatório próprio — "editar" = nova versão (nova row,
 * mesma familyId). Por isso a response não precisa de snapshot das perguntas:
 * a imutabilidade do template É o snapshot.
 */

export const SURVEY_QUESTION_TYPES = [
  "nps",
  "csat",
  "single",
  "multi",
  "text",
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const SURVEY_RECIPIENT_ROLES = [
  "vendedor",
  "comprador",
  "locador",
  "locatario",
  "corretor",
] as const;
export type SurveyRecipientRole = (typeof SURVEY_RECIPIENT_ROLES)[number];

/** Audiências válidas por kind do deal (venda não tem locatário e vice-versa). */
export const AUDIENCE_BY_KIND: Record<string, readonly SurveyRecipientRole[]> = {
  venda: ["vendedor", "comprador", "corretor"],
  locacao: ["locador", "locatario", "corretor"],
};

export const SURVEY_CHANNELS = ["email", "whatsapp", "manual"] as const;
export type SurveyChannel = (typeof SURVEY_CHANNELS)[number];

/** Mínimo de respostas de texto pro resumo IA do lote — fonte única
 *  (server valida, client gateia o botão). Arquivo client-safe. */
export const SUMMARY_MIN_TEXT_RESPONSES = 3;

/**
 * Stages elegíveis como gatilho de automação, por kind (nomes canônicos —
 * mesma fonte nominal de lib/pipeline/stage-config.ts e auto-promote-signed).
 * Client-safe: o form de automação renderiza o select a partir daqui.
 */
export const TRIGGER_STAGES_BY_KIND: Record<string, readonly string[]> = {
  venda: [
    "Formulário",
    "Confecção de Contrato",
    "Enviado para assinatura",
    "Contrato assinado",
    "Cobrança emitida",
    "Comissão paga",
    "Negócio perdido",
  ],
  locacao: [
    "Em Aprovação",
    "Formulário",
    "Em contrato",
    "Assinado",
    "Cobrança Gerada",
    "ADM",
    "Negócio perdido",
  ],
};

export const SURVEY_INVITE_STATUSES = [
  "pending",
  "sent",
  "responded",
  "expired",
  "optout",
  "failed",
] as const;
export type SurveyInviteStatus = (typeof SURVEY_INVITE_STATUSES)[number];

const questionBase = {
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(500),
  required: z.boolean().default(true),
};

// NPS (0-10) e CSAT (1-5) são tipos dedicados — o dashboard só agrega a partir
// deles (colunas derivadas npsScore/csatScore na response).
export const surveyQuestionSchema = z.discriminatedUnion("type", [
  z.object({ ...questionBase, type: z.literal("nps") }),
  z.object({ ...questionBase, type: z.literal("csat") }),
  z.object({
    ...questionBase,
    type: z.literal("single"),
    options: z.array(z.string().min(1).max(200)).min(2).max(12),
  }),
  z.object({
    ...questionBase,
    type: z.literal("multi"),
    options: z.array(z.string().min(1).max(200)).min(2).max(12),
  }),
  z.object({ ...questionBase, type: z.literal("text") }),
]);
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

/**
 * Lista de perguntas do template. Máx 15; máx 1 NPS e 1 CSAT por template —
 * mantém as colunas derivadas da response não-ambíguas; ids únicos.
 */
export const surveyQuestionsSchema = z
  .array(surveyQuestionSchema)
  .min(1, "A pesquisa precisa de ao menos uma pergunta")
  .max(15, "Máximo de 15 perguntas por pesquisa")
  .superRefine((questions, ctx) => {
    const ids = new Set<string>();
    let nps = 0;
    let csat = 0;
    for (const q of questions) {
      if (ids.has(q.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Pergunta com id duplicado: ${q.id}`,
        });
      }
      ids.add(q.id);
      if (q.type === "nps") nps++;
      if (q.type === "csat") csat++;
    }
    if (nps > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No máximo 1 pergunta NPS por pesquisa",
      });
    }
    if (csat > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No máximo 1 pergunta CSAT por pesquisa",
      });
    }
  });

export const surveySettingsSchema = z
  .object({
    thankYouMessage: z.string().max(1000).optional(),
    // Reservado pra futuro — dashboard ocultaria identidade do respondente.
    anonymous: z.boolean().optional(),
  })
  .passthrough();

export const surveyTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  questions: surveyQuestionsSchema,
  settings: surveySettingsSchema.optional(),
});
export type SurveyTemplateCreateInput = z.infer<typeof surveyTemplateCreateSchema>;

export const surveyAnswerSchema = z.object({
  questionId: z.string().min(1),
  type: z.enum(SURVEY_QUESTION_TYPES),
  // number (nps/csat), string (single/text), string[] (multi)
  value: z.union([
    z.number(),
    z.string().max(5000),
    z.array(z.string().max(200)).max(12),
  ]),
});
export type SurveyAnswer = z.infer<typeof surveyAnswerSchema>;

export type AnswersValidation =
  | { ok: true; answers: SurveyAnswer[] }
  | { ok: false; error: string };

/**
 * Valida as respostas CONTRA o questionsJson do template (server-side).
 * Toda pergunta required precisa de resposta; valores fora do domínio
 * (nps fora de 0-10, opção inexistente etc.) são rejeitados.
 */
export function validateAnswers(
  questions: SurveyQuestion[],
  rawAnswers: unknown
): AnswersValidation {
  const parsed = z.array(surveyAnswerSchema).max(30).safeParse(rawAnswers);
  if (!parsed.success) {
    return { ok: false, error: "Formato de respostas inválido" };
  }

  const byQuestion = new Map<string, SurveyAnswer>();
  for (const answer of parsed.data) {
    if (byQuestion.has(answer.questionId)) {
      return { ok: false, error: `Resposta duplicada: ${answer.questionId}` };
    }
    byQuestion.set(answer.questionId, answer);
  }

  const known = new Set(questions.map((q) => q.id));
  for (const answer of parsed.data) {
    if (!known.has(answer.questionId)) {
      return { ok: false, error: `Pergunta desconhecida: ${answer.questionId}` };
    }
  }

  const accepted: SurveyAnswer[] = [];
  for (const question of questions) {
    const answer = byQuestion.get(question.id);
    if (!answer) {
      if (question.required) {
        return { ok: false, error: `Pergunta obrigatória sem resposta: ${question.label}` };
      }
      continue;
    }
    if (answer.type !== question.type) {
      return { ok: false, error: `Tipo de resposta inválido em: ${question.label}` };
    }

    switch (question.type) {
      case "nps": {
        const v = answer.value;
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10) {
          return { ok: false, error: `Nota NPS inválida em: ${question.label}` };
        }
        break;
      }
      case "csat": {
        const v = answer.value;
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
          return { ok: false, error: `Nota CSAT inválida em: ${question.label}` };
        }
        break;
      }
      case "single": {
        const v = answer.value;
        if (typeof v !== "string" || !question.options.includes(v)) {
          return { ok: false, error: `Opção inválida em: ${question.label}` };
        }
        break;
      }
      case "multi": {
        const v = answer.value;
        if (
          !Array.isArray(v) ||
          v.length === 0 ||
          v.some((item) => !question.options.includes(item)) ||
          new Set(v).size !== v.length
        ) {
          return { ok: false, error: `Opções inválidas em: ${question.label}` };
        }
        break;
      }
      case "text": {
        const v = answer.value;
        if (typeof v !== "string" || (question.required && v.trim().length === 0)) {
          return { ok: false, error: `Resposta vazia em: ${question.label}` };
        }
        break;
      }
    }
    accepted.push(answer);
  }

  return { ok: true, answers: accepted };
}

/** Parse defensivo do questionsJson vindo do banco (sempre gravado validado). */
export function parseTemplateQuestions(questionsJson: unknown): SurveyQuestion[] {
  const parsed = surveyQuestionsSchema.safeParse(questionsJson);
  return parsed.success ? parsed.data : [];
}
