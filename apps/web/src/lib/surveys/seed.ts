import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  surveyTemplateCreateSchema,
  type SurveyTemplateCreateInput,
} from "@/lib/surveys/types";

/**
 * Template padrão de pesquisa de satisfação — semeado em org nova e, via
 * scripts/seed-survey-templates.ts, nas orgs existentes sem nenhum template
 * ativo. Neutro entre vendas e locação (templates são compartilhados).
 */
export const DEFAULT_SURVEY_TEMPLATE: SurveyTemplateCreateInput = {
  name: "Pesquisa de satisfação",
  description:
    "Pesquisa padrão pós-negócio: NPS, satisfação com o atendimento e comentário livre.",
  questions: [
    {
      id: "nps",
      type: "nps",
      label:
        "De 0 a 10, o quanto você recomendaria nossa imobiliária a um amigo ou familiar?",
      required: true,
    },
    {
      id: "csat",
      type: "csat",
      label: "Como você avalia o atendimento que recebeu durante o processo?",
      required: true,
    },
    {
      id: "comentario",
      type: "text",
      label: "Conte pra gente o que foi bem e o que podemos melhorar.",
      required: false,
    },
  ],
  settings: {
    thankYouMessage: "Obrigado por responder! Sua opinião nos ajuda a melhorar.",
  },
};

/**
 * Semeia o template padrão numa org, se ela não tiver nenhum template ativo
 * nem um template (mesmo arquivado) com o mesmo nome — idempotente por
 * (orgId, name). `apply: false` só reporta o que faria (dry-run).
 * `createdBy` cai no owner da org quando não informado (SurveyTemplate exige).
 */
export async function seedDefaultSurveyTemplateForOrg(
  orgId: string,
  opts: { apply: boolean; createdBy?: string } = { apply: true }
): Promise<"created" | "would_create" | "has_active" | "name_exists" | "no_owner"> {
  const active = await prisma.surveyTemplate.findFirst({
    where: { orgId, isLatest: true, status: "active" },
    select: { id: true },
  });
  if (active) return "has_active";

  const sameName = await prisma.surveyTemplate.findFirst({
    where: { orgId, name: DEFAULT_SURVEY_TEMPLATE.name },
    select: { id: true },
  });
  if (sameName) return "name_exists";

  let createdBy = opts.createdBy;
  if (!createdBy) {
    const owner = await prisma.orgMembership.findFirst({
      where: { orgId, role: "owner", isSystem: false },
      orderBy: { invitedAt: "asc" },
      select: { userId: true },
    });
    if (!owner) return "no_owner";
    createdBy = owner.userId;
  }

  // Parse ANTES do retorno de dry-run: se o template default virar inválido
  // (refinements zod que o tipo TS não captura), o dry-run já quebra — em vez
  // de prometer um apply que falharia no meio do loop.
  const data = surveyTemplateCreateSchema.parse(DEFAULT_SURVEY_TEMPLATE);
  if (!opts.apply) return "would_create";

  const raced = await prisma.$transaction(async (tx) => {
    // Re-checagem dentro da transação: estreita a corrida com outro seeder
    // (script × admin/orgs). Não dá pra fechar com @@unique([orgId, name]) —
    // versões de template compartilham o nome de propósito — então a corrida
    // residual, se acontecer, só produz um default duplicado deletável.
    const dupe = await tx.surveyTemplate.findFirst({
      where: {
        orgId,
        OR: [{ isLatest: true, status: "active" }, { name: data.name }],
      },
      select: { id: true },
    });
    if (dupe) return true;
    const template = await tx.surveyTemplate.create({
      data: {
        orgId,
        familyId: "pending", // familyId = id na v1; cuid só existe pós-create
        name: data.name,
        description: data.description,
        questionsJson: data.questions as unknown as Prisma.InputJsonValue,
        settingsJson: (data.settings ?? {}) as Prisma.InputJsonValue,
        createdBy,
      },
    });
    await tx.surveyTemplate.update({
      where: { id: template.id },
      data: { familyId: template.id },
    });
    return false;
  });
  return raced ? "has_active" : "created";
}
