import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { ModuleDisabledError } from "@/lib/modules/guard";
import { assertAnySurveyFeature } from "@/lib/surveys/guard";
import { surveyTemplateCreateSchema } from "@/lib/surveys/types";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/surveys/templates — famílias (isLatest) com contagens de versões,
// envios e respostas. `?family=<familyId>` devolve todas as versões da família.
export async function GET(req: NextRequest) {
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

  const familyId = new URL(req.url).searchParams.get("family");

  const templates = await prisma.surveyTemplate.findMany({
    where: familyId
      ? { orgId: auth.org.id, familyId }
      : { orgId: auth.org.id, isLatest: true },
    orderBy: familyId ? { version: "desc" } : { updatedAt: "desc" },
    select: {
      id: true,
      familyId: true,
      version: true,
      isLatest: true,
      name: true,
      description: true,
      status: true,
      questionsJson: true,
      createdAt: true,
      _count: { select: { invites: true, responses: true } },
    },
  });

  // Contagem de versões por família (só na listagem de famílias).
  let versionCounts: Record<string, number> = {};
  if (!familyId && templates.length > 0) {
    const grouped = await prisma.surveyTemplate.groupBy({
      by: ["familyId"],
      where: { orgId: auth.org.id, familyId: { in: templates.map((t) => t.familyId) } },
      _count: { _all: true },
    });
    versionCounts = Object.fromEntries(grouped.map((g) => [g.familyId, g._count._all]));
  }

  return NextResponse.json({
    templates: templates.map((t) => ({
      ...t,
      versionCount: versionCounts[t.familyId] ?? undefined,
    })),
  });
}

// POST /api/surveys/templates — cria a v1 de uma pesquisa (familyId = id).
// O template nasce IMUTÁVEL: questionsJson nunca recebe PATCH depois daqui.
export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => null);
  const parsed = surveyTemplateCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const template = await tx.surveyTemplate.create({
      data: {
        orgId: auth.org.id,
        familyId: "pending", // familyId = id na v1; cuid só existe pós-create
        name: parsed.data.name,
        description: parsed.data.description,
        questionsJson: parsed.data.questions,
        settingsJson: (parsed.data.settings ?? {}) as Prisma.InputJsonValue,
        createdBy: auth.actor.effectiveUserId,
      },
    });
    return tx.surveyTemplate.update({
      where: { id: template.id },
      data: { familyId: template.id },
    });
  });

  void audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
    action: "SURVEY_TEMPLATE_CREATE",
    result: "SUCCESS",
    resource: created.id,
    resourceType: "SurveyTemplate",
    metadata: { name: created.name, questions: parsed.data.questions.length },
  });

  return NextResponse.json({ template: created }, { status: 201 });
}
