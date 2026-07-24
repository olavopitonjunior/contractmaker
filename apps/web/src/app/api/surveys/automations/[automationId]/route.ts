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
import {
  AUDIENCE_BY_KIND,
  SURVEY_RECIPIENT_ROLES,
} from "@/lib/surveys/types";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    audience: z.array(z.enum(SURVEY_RECIPIENT_ROLES)).min(1).optional(),
    channel: z.enum(["email", "manual"]).optional(),
    enabled: z.boolean().optional(),
    reminderOffsetsDays: z.array(z.number().int().min(0).max(60)).max(5).optional(),
  })
  .strict();

async function guarded(req: NextRequest, automationId: string) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return { fail: authFailureResponse(auth) } as const;
  try {
    await assertAnySurveyFeature(auth.org.id);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return {
        fail: NextResponse.json({ error: e.message }, { status: e.status }),
      } as const;
    }
    throw e;
  }
  const automation = await prisma.surveyAutomation.findFirst({
    where: { id: automationId, orgId: auth.org.id },
  });
  if (!automation) {
    return {
      fail: NextResponse.json({ error: "Automação não encontrada" }, { status: 404 }),
    } as const;
  }
  return { auth, automation } as const;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { automationId: string } }
) {
  const g = await guarded(req, params.automationId);
  if ("fail" in g) return g.fail;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  if (parsed.data.audience) {
    const allowed = new Set(AUDIENCE_BY_KIND[g.automation.dealKind] ?? []);
    if (parsed.data.audience.some((role) => !allowed.has(role))) {
      return NextResponse.json(
        { error: `Audiência inválida pra ${g.automation.dealKind}` },
        { status: 400 }
      );
    }
  }

  const automation = await prisma.surveyAutomation.update({
    where: { id: g.automation.id },
    data: parsed.data,
  });

  void audit(
    extractAuditContextFromRequest(req, g.auth.org.id, g.auth.actor.effectiveUserId),
    {
      action: "SURVEY_AUTOMATION_UPSERT",
      result: "SUCCESS",
      resource: automation.id,
      resourceType: "SurveyAutomation",
      metadata: { patch: Object.keys(parsed.data) },
    }
  );

  return NextResponse.json({ automation });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { automationId: string } }
) {
  const g = await guarded(req, params.automationId);
  if ("fail" in g) return g.fail;

  await prisma.surveyAutomation.delete({ where: { id: g.automation.id } });

  void audit(
    extractAuditContextFromRequest(req, g.auth.org.id, g.auth.actor.effectiveUserId),
    {
      action: "SURVEY_AUTOMATION_DELETE",
      result: "SUCCESS",
      resource: g.automation.id,
      resourceType: "SurveyAutomation",
      metadata: {
        templateFamilyId: g.automation.templateFamilyId,
        stage: g.automation.triggerStageName,
      },
    }
  );

  return NextResponse.json({ ok: true });
}
