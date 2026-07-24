import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { ModuleDisabledError } from "@/lib/modules/guard";
import { assertAnySurveyFeature } from "@/lib/surveys/guard";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Template é IMUTÁVEL: PATCH aceita SÓ name/description/status. questionsJson
// nunca é editável — "editar perguntas" = POST .../new-version (novo lote).
const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict();

async function loadScoped(templateId: string, orgId: string) {
  return prisma.surveyTemplate.findFirst({
    where: { id: templateId, orgId },
  });
}

export async function GET(
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

  const template = await loadScoped(params.templateId, auth.org.id);
  if (!template) {
    return NextResponse.json({ error: "Pesquisa não encontrada" }, { status: 404 });
  }

  const versions = await prisma.surveyTemplate.findMany({
    where: { orgId: auth.org.id, familyId: template.familyId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      isLatest: true,
      status: true,
      createdAt: true,
      _count: { select: { invites: true, responses: true } },
    },
  });

  return NextResponse.json({ template, versions });
}

export async function PATCH(
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

  const template = await loadScoped(params.templateId, auth.org.id);
  if (!template) {
    return NextResponse.json({ error: "Pesquisa não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos — perguntas de uma pesquisa criada não podem ser editadas" },
      { status: 400 }
    );
  }

  const updated = await prisma.surveyTemplate.update({
    where: { id: template.id },
    data: parsed.data,
  });

  if (parsed.data.status === "archived" && template.status !== "archived") {
    void audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
      action: "SURVEY_TEMPLATE_ARCHIVE",
      result: "SUCCESS",
      resource: template.id,
      resourceType: "SurveyTemplate",
      metadata: { familyId: template.familyId, version: template.version },
    });
  }

  return NextResponse.json({ template: updated });
}
