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
  TRIGGER_STAGES_BY_KIND,
} from "@/lib/surveys/types";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const automationSchema = z
  .object({
    templateFamilyId: z.string().min(1),
    dealKind: z.enum(["venda", "locacao"]),
    triggerStageName: z.string().min(1),
    audience: z.array(z.enum(SURVEY_RECIPIENT_ROLES)).min(1),
    channel: z.enum(["email", "manual"]), // whatsapp entra quando o Newton integrar
    enabled: z.boolean().default(true),
    reminderOffsetsDays: z
      .array(z.number().int().min(0).max(60))
      .max(5)
      .default([2, 5]),
  })
  .superRefine((data, ctx) => {
    if (!TRIGGER_STAGES_BY_KIND[data.dealKind]?.includes(data.triggerStageName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["triggerStageName"],
        message: `Etapa inválida pra ${data.dealKind}`,
      });
    }
    const allowed = new Set(AUDIENCE_BY_KIND[data.dealKind] ?? []);
    for (const role of data.audience) {
      if (!allowed.has(role)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["audience"],
          message: `Papel "${role}" inválido pra ${data.dealKind}`,
        });
      }
    }
  });

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
  const automations = await prisma.surveyAutomation.findMany({
    where: {
      orgId: auth.org.id,
      ...(familyId ? { templateFamilyId: familyId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ automations });
}

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
  const parsed = automationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Família precisa existir NA org (guard cross-org).
  const family = await prisma.surveyTemplate.findFirst({
    where: { orgId: auth.org.id, familyId: parsed.data.templateFamilyId },
    select: { id: true },
  });
  if (!family) {
    return NextResponse.json({ error: "Pesquisa não encontrada" }, { status: 404 });
  }

  const automation = await prisma.surveyAutomation.create({
    data: { orgId: auth.org.id, ...parsed.data },
  });

  void audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
    action: "SURVEY_AUTOMATION_UPSERT",
    result: "SUCCESS",
    resource: automation.id,
    resourceType: "SurveyAutomation",
    metadata: {
      templateFamilyId: automation.templateFamilyId,
      dealKind: automation.dealKind,
      stage: automation.triggerStageName,
      created: true,
    },
  });

  return NextResponse.json({ automation }, { status: 201 });
}
