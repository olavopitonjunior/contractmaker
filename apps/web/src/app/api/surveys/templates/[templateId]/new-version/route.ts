import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { ModuleDisabledError } from "@/lib/modules/guard";
import { assertAnySurveyFeature } from "@/lib/surveys/guard";
import {
  surveyQuestionsSchema,
  surveySettingsSchema,
} from "@/lib/surveys/types";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  questions: surveyQuestionsSchema,
  settings: surveySettingsSchema.optional(),
});

// POST /api/surveys/templates/[templateId]/new-version
//
// "Editar" uma pesquisa = criar nova versão: nova row na mesma familyId, com
// version+1 e isLatest — um NOVO LOTE com relatório zerado. A versão anterior
// congela com suas respostas. Transacional pra manter o invariante do índice
// único parcial (1 isLatest por família).
export async function POST(
  req: NextRequest,
  { params }: { params: { templateId: string } }
) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);
  try {
    await assertAnySurveyFeature(auth.org.id);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const source = await prisma.surveyTemplate.findFirst({
    where: { id: params.templateId, orgId: auth.org.id },
  });
  if (!source) {
    return NextResponse.json({ error: "Pesquisa não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // A versão-viva atual da família (pode não ser a row alvo do POST).
      const latest = await tx.surveyTemplate.findFirst({
        where: { orgId: auth.org.id, familyId: source.familyId, isLatest: true },
        orderBy: { version: "desc" },
      });
      if (latest) {
        await tx.surveyTemplate.update({
          where: { id: latest.id },
          data: { isLatest: false },
        });
      }
      return tx.surveyTemplate.create({
        data: {
          orgId: auth.org.id,
          familyId: source.familyId,
          version: (latest?.version ?? source.version) + 1,
          isLatest: true,
          parentVersionId: latest?.id ?? source.id,
          name: parsed.data.name ?? source.name,
          description:
            parsed.data.description === undefined
              ? source.description
              : parsed.data.description,
          status: "active",
          questionsJson: parsed.data.questions,
          settingsJson: (parsed.data.settings ??
            source.settingsJson ??
            {}) as Prisma.InputJsonValue,
          createdBy: auth.actor.effectiveUserId,
        },
      });
    });
  } catch (e) {
    // Corrida de dois "nova versão" simultâneos: o índice único parcial
    // (isLatest por família) derruba o perdedor com P2002 — 409 amigável.
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: "Outra versão acabou de ser criada — recarregue e tente de novo" },
        { status: 409 }
      );
    }
    throw e;
  }

  void audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
    action: "SURVEY_TEMPLATE_NEW_VERSION",
    result: "SUCCESS",
    resource: created.id,
    resourceType: "SurveyTemplate",
    metadata: {
      familyId: created.familyId,
      version: created.version,
      previousVersionId: created.parentVersionId,
    },
  });

  return NextResponse.json({ template: created }, { status: 201 });
}
